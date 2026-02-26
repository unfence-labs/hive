import { connect, type ClientHttp2Session } from "node:http2";
import { createSign } from "node:crypto";
import type { NotificationChannel, NotificationEvent } from "./types.js";
import type { ApnsConfig } from "../state/config.js";

const PRODUCTION_HOST = "https://api.push.apple.com";
const SANDBOX_HOST = "https://api.sandbox.push.apple.com";
const JWT_REFRESH_SECONDS = 50 * 60; // refresh before 60-min expiry

// ---------------------------------------------------------------------------
// JWT helpers (ES256 via node:crypto — zero dependencies)
// ---------------------------------------------------------------------------

interface CachedJwt {
  token: string;
  issuedAt: number;
}

/** Convert DER-encoded ECDSA signature to raw r||s (64 bytes for P-256). */
function derToRaw(der: Buffer): Buffer {
  const raw = Buffer.alloc(64);
  let offset = 2; // skip SEQUENCE tag + total length byte

  // r integer
  const rLen = der[offset + 1]!;
  const rData = der.subarray(offset + 2, offset + 2 + rLen);
  const rTrimmed = rLen > 32 ? rData.subarray(rLen - 32) : rData;
  rTrimmed.copy(raw, 32 - rTrimmed.length);
  offset += 2 + rLen;

  // s integer
  const sLen = der[offset + 1]!;
  const sData = der.subarray(offset + 2, offset + 2 + sLen);
  const sTrimmed = sLen > 32 ? sData.subarray(sLen - 32) : sData;
  sTrimmed.copy(raw, 64 - sTrimmed.length);

  return raw;
}

function generateJwt(teamId: string, keyId: string, keyContent: string): CachedJwt {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: keyId })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: teamId, iat: now })).toString("base64url");

  const signer = createSign("SHA256");
  signer.update(`${header}.${payload}`);
  const derSig = signer.sign(keyContent);
  const signature = derToRaw(derSig).toString("base64url");

  return { token: `${header}.${payload}.${signature}`, issuedAt: now };
}

// ---------------------------------------------------------------------------
// Push helper
// ---------------------------------------------------------------------------

interface PushResult {
  status: number;
  body: string;
}

function pushToDevice(
  session: ClientHttp2Session,
  token: string,
  payloadJson: string,
  jwt: string,
  bundleId: string,
): Promise<PushResult> {
  return new Promise((resolve) => {
    const req = session.request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      authorization: `bearer ${jwt}`,
      "apns-topic": bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
    });
    req.setEncoding("utf8");
    let data = "";
    let status = 0;
    req.on("response", (headers) => {
      status = Number(headers[":status"]);
    });
    req.on("data", (chunk: string) => {
      data += chunk;
    });
    req.on("end", () => resolve({ status, body: data }));
    req.on("error", (err) => {
      console.error("[apns] request error:", err);
      resolve({ status: 0, body: String(err) });
    });
    req.end(payloadJson);
  });
}

// ---------------------------------------------------------------------------
// ApnsChannel
// ---------------------------------------------------------------------------

export class ApnsChannel implements NotificationChannel {
  readonly name = "apns";

  private session: ClientHttp2Session | null = null;
  private jwt: CachedJwt | null = null;

  private constructor(
    private readonly teamId: string,
    private readonly keyId: string,
    private readonly keyContent: string,
    private readonly bundleId: string,
    private readonly sandbox: boolean,
    private deviceTokens: string[],
    private readonly onTokensChanged: (tokens: string[]) => void,
  ) {}

  static fromConfig(
    cfg: ApnsConfig,
    onTokensChanged: (tokens: string[]) => void,
  ): ApnsChannel | null {
    if (!cfg.teamId.trim() || !cfg.keyId.trim() || !cfg.keyContent.trim() || !cfg.bundleId.trim()) {
      return null;
    }
    return new ApnsChannel(
      cfg.teamId.trim(),
      cfg.keyId.trim(),
      cfg.keyContent.trim(),
      cfg.bundleId.trim(),
      cfg.sandbox,
      [...cfg.deviceTokens],
      onTokensChanged,
    );
  }

  static async sendTest(
    teamId: string,
    keyId: string,
    keyContent: string,
    bundleId: string,
    sandbox: boolean,
    deviceTokens: string[],
  ): Promise<{ ok: boolean; error?: string }> {
    if (deviceTokens.length === 0) {
      return { ok: false, error: "No iOS devices registered" };
    }
    try {
      const jwt = generateJwt(teamId.trim(), keyId.trim(), keyContent.trim());
      const host = sandbox ? SANDBOX_HOST : PRODUCTION_HOST;
      const session = connect(host);
      const payload = JSON.stringify({
        aps: {
          alert: { title: "Hive", body: "Test notification — APNs is working!" },
          sound: "default",
        },
      });

      try {
        const results = await Promise.all(
          deviceTokens.map((t) => pushToDevice(session, t, payload, jwt.token, bundleId.trim())),
        );
        const failed = results.filter((r) => r.status !== 200);
        if (failed.length > 0) {
          return { ok: false, error: `Push failed for ${failed.length}/${results.length} device(s): ${failed[0]!.body}` };
        }
        return { ok: true };
      } finally {
        session.close();
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
    }
  }

  isEnabled(): boolean {
    return true;
  }

  async send(event: NotificationEvent): Promise<void> {
    if (this.deviceTokens.length === 0) return;

    let title: string;
    let body: string;
    let extraData: Record<string, string> = {};

    if (event.type === "agent_turn_complete") {
      title = "Agent finished";
      body = `${event.projectName} / ${event.workspaceName}`;
      extraData = { workspaceId: event.workspaceId };
    } else {
      const statusLabel = event.status === "success" ? "Success" : "Failed";
      title = `Automation: ${event.automationName}`;
      body = `Status: ${statusLabel}${event.projectName ? ` | ${event.projectName}` : ""}`;
      extraData = { automationId: event.automationId };
    }

    const payload = JSON.stringify({
      aps: {
        alert: { title, body },
        sound: "default",
      },
      ...extraData,
    });

    const session = this.getOrCreateSession();
    const jwt = this.getOrRefreshJwt();
    const invalidTokens: string[] = [];

    const results = await Promise.allSettled(
      this.deviceTokens.map((token) =>
        pushToDevice(session, token, payload, jwt.token, this.bundleId),
      ),
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      if (result.status === "fulfilled" && result.value.status === 410) {
        invalidTokens.push(this.deviceTokens[i]!);
      } else if (result.status === "fulfilled" && result.value.status !== 200) {
        console.error(`[apns] push failed (${result.value.status}):`, result.value.body);
      }
    }

    if (invalidTokens.length > 0) {
      this.deviceTokens = this.deviceTokens.filter((t) => !invalidTokens.includes(t));
      this.onTokensChanged([...this.deviceTokens]);
    }
  }

  addToken(token: string): boolean {
    const hex = token.toLowerCase().replace(/[^a-f0-9]/g, "");
    if (this.deviceTokens.includes(hex)) return false;
    this.deviceTokens.push(hex);
    this.onTokensChanged([...this.deviceTokens]);
    return true;
  }

  destroy(): void {
    this.session?.close();
    this.session = null;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private getOrCreateSession(): ClientHttp2Session {
    if (this.session && !this.session.closed && !this.session.destroyed) {
      return this.session;
    }
    const host = this.sandbox ? SANDBOX_HOST : PRODUCTION_HOST;
    this.session = connect(host);
    this.session.on("error", (err) => {
      console.error("[apns] http2 session error:", err);
      this.session = null;
    });
    this.session.on("close", () => {
      this.session = null;
    });
    return this.session;
  }

  private getOrRefreshJwt(): CachedJwt {
    const now = Math.floor(Date.now() / 1000);
    if (this.jwt && now - this.jwt.issuedAt < JWT_REFRESH_SECONDS) {
      return this.jwt;
    }
    this.jwt = generateJwt(this.teamId, this.keyId, this.keyContent);
    return this.jwt;
  }
}
