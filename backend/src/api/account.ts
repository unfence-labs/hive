import { execFile as execFileCb } from "node:child_process";
import type { FastifyInstance } from "fastify";
import { gh, isGhInstalled, _resetGhState } from "../utils/github.js";

interface GitHubUser {
  login: string;
  name: string;
  email: string;
  avatarUrl: string;
}

interface DeviceFlowState {
  deviceCode: string;
  clientId: string;
  expiresAt: number;
  interval: number;
}

let pendingDeviceFlow: DeviceFlowState | null = null;

function getClientId(): string | undefined {
  return process.env.GITHUB_CLIENT_ID?.trim() || undefined;
}

async function fetchGitHubUser(): Promise<GitHubUser | null> {
  try {
    const { stdout } = await gh(["api", "user"]);
    const data = JSON.parse(stdout);
    return {
      login: data.login ?? "",
      name: data.name ?? "",
      email: data.email ?? "",
      avatarUrl: data.avatar_url ?? "",
    };
  } catch {
    return null;
  }
}

async function isGhAuthenticated(): Promise<boolean> {
  try {
    await gh(["auth", "status", "--hostname", "github.com"]);
    return true;
  } catch {
    return false;
  }
}

async function loginWithToken(token: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = execFileCb("gh", ["auth", "login", "--with-token"], (err) => {
      if (err) reject(err);
      else resolve();
    });
    child.stdin?.write(token);
    child.stdin?.end();
  });
}

async function setupGitCredentials(): Promise<void> {
  try {
    await gh(["auth", "setup-git"]);
  } catch {
    // non-fatal: git credentials are a nice-to-have
  }
}

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/account/status", async () => {
    const installed = await isGhInstalled();
    if (!installed) {
      return { ghInstalled: false, authenticated: false, deviceFlowAvailable: false };
    }

    const authenticated = await isGhAuthenticated();
    const clientId = getClientId();

    if (!authenticated) {
      return { ghInstalled: true, authenticated: false, deviceFlowAvailable: !!clientId };
    }

    const user = await fetchGitHubUser();
    return { ghInstalled: true, authenticated: true, deviceFlowAvailable: !!clientId, user };
  });

  app.post("/api/account/connect", async (_req, reply) => {
    const clientId = getClientId();
    if (!clientId) {
      return reply.status(400).send({ error: "GITHUB_CLIENT_ID not configured" });
    }

    const installed = await isGhInstalled();
    if (!installed) {
      return reply.status(400).send({ error: "gh CLI not installed" });
    }

    const res = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        scope: "repo read:user user:email",
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return reply.status(502).send({ error: `GitHub API error: ${text}` });
    }

    const data = (await res.json()) as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      expires_in: number;
      interval: number;
      error?: string;
      error_description?: string;
    };

    if (data.error) {
      return reply.status(400).send({ error: data.error_description ?? data.error });
    }

    pendingDeviceFlow = {
      deviceCode: data.device_code,
      clientId,
      expiresAt: Date.now() + data.expires_in * 1000,
      interval: data.interval,
    };

    return {
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      expiresIn: data.expires_in,
      interval: data.interval,
    };
  });

  app.post("/api/account/connect/poll", async (_req, reply) => {
    if (!pendingDeviceFlow) {
      return reply.status(400).send({ error: "No pending device flow" });
    }

    if (Date.now() > pendingDeviceFlow.expiresAt) {
      pendingDeviceFlow = null;
      return { status: "expired" };
    }

    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: pendingDeviceFlow.clientId,
        device_code: pendingDeviceFlow.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    const data = (await res.json()) as {
      access_token?: string;
      error?: string;
      interval?: number;
    };

    if (data.error === "authorization_pending") {
      return { status: "pending" };
    }
    if (data.error === "slow_down") {
      if (data.interval) pendingDeviceFlow.interval = data.interval;
      return { status: "slow_down", interval: pendingDeviceFlow.interval };
    }
    if (data.error === "expired_token") {
      pendingDeviceFlow = null;
      return { status: "expired" };
    }
    if (data.error === "access_denied") {
      pendingDeviceFlow = null;
      return { status: "denied" };
    }
    if (data.error) {
      pendingDeviceFlow = null;
      return reply.status(400).send({ error: data.error });
    }

    if (!data.access_token) {
      return reply.status(502).send({ error: "No access token in response" });
    }

    // Login with the token, configure git, fetch user profile
    try {
      await loginWithToken(data.access_token);
      _resetGhState();
      await setupGitCredentials();
    } catch (err: unknown) {
      const message = (err as Error).message ?? "Failed to configure gh";
      return reply.status(500).send({ error: message });
    }

    pendingDeviceFlow = null;

    const user = await fetchGitHubUser();
    return { status: "complete", user };
  });

  app.post("/api/account/disconnect", async (_req, reply) => {
    try {
      await gh(["auth", "logout", "--hostname", "github.com", "--yes"]);
      _resetGhState();
      return { ok: true };
    } catch (err: unknown) {
      const message = (err as Error).message ?? "Failed to disconnect";
      return reply.status(500).send({ error: message });
    }
  });
}
