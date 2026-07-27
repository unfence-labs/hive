import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";

/**
 * Records the byte length of every operand handed to `timingSafeEqual` so the
 * constant-time property can be asserted structurally rather than by timing.
 */
const { timingSafeEqualOperandSizes } = vi.hoisted(() => ({
  timingSafeEqualOperandSizes: [] as Array<[number, number]>,
}));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    timingSafeEqual(left: NodeJS.ArrayBufferView, right: NodeJS.ArrayBufferView) {
      timingSafeEqualOperandSizes.push([left.byteLength, right.byteLength]);
      return actual.timingSafeEqual(left, right);
    },
  };
});

import {
  allowedBrowserOrigins,
  allowedHostNames,
  createAuthHook,
  createHostGuardHook,
  createWebSocketOriginGuardHook,
  extractAuthToken,
  isAllowedHostHeader,
  isAuthorized,
} from "./auth.js";

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function replyRecorder() {
  const state: { statusCode?: number; payload?: unknown } = {};
  const reply = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    send(payload: unknown) {
      state.payload = payload;
    },
  };
  return { state, reply };
}

describe("extractAuthToken", () => {
  it("extracts token from Authorization bearer header", () => {
    expect(extractAuthToken({ authorization: "Bearer abc123" })).toBe("abc123");
  });

  it("extracts token from x-hive-token header", () => {
    expect(extractAuthToken({ "x-hive-token": "secret" })).toBe("secret");
  });

  it("returns undefined when no token is present", () => {
    expect(extractAuthToken({})).toBeUndefined();
  });
});

describe("isAuthorized", () => {
  it("returns true when auth is disabled", () => {
    expect(isAuthorized({}, undefined)).toBe(true);
  });

  it("accepts matching bearer token", () => {
    expect(isAuthorized({ authorization: "Bearer secret" }, "secret")).toBe(true);
  });

  it("rejects mismatched token", () => {
    expect(isAuthorized({ authorization: "Bearer nope" }, "secret")).toBe(false);
  });

  it("accepts matching fallback token", () => {
    expect(isAuthorized({}, "secret", "secret")).toBe(true);
  });

  it("accepts a matching token via object expectation", () => {
    expect(isAuthorized(bearer("secret"), { expectedToken: "secret" })).toBe(true);
  });

  it("accepts the x-hive-token header", () => {
    expect(isAuthorized({ "x-hive-token": "secret" }, "secret")).toBe(true);
  });
});

describe("isAuthorized — hashed mode", () => {
  const token = "sk-hive-abcdef";
  const hash = sha256Hex(token);

  it("accepts the token whose SHA-256 matches the expected hash", () => {
    expect(isAuthorized(bearer(token), { expectedTokenSha256: hash })).toBe(true);
  });

  it("rejects a token whose hash does not match", () => {
    expect(isAuthorized(bearer("wrong-token"), { expectedTokenSha256: hash })).toBe(false);
  });

  it("rejects when no token is provided", () => {
    expect(isAuthorized({}, { expectedTokenSha256: hash })).toBe(false);
  });

  it("is case-insensitive on the configured hash hex", () => {
    expect(isAuthorized(bearer(token), { expectedTokenSha256: hash.toUpperCase() })).toBe(true);
  });

  it("accepts via the fallback (query) token in hashed mode", () => {
    expect(isAuthorized({}, { expectedTokenSha256: hash }, token)).toBe(true);
  });

  it("does not accept the raw hash as if it were the token", () => {
    expect(isAuthorized(bearer(hash), { expectedTokenSha256: hash })).toBe(false);
  });

  it("stays open when neither token nor hash is configured", () => {
    expect(isAuthorized({}, {})).toBe(true);
    expect(isAuthorized({}, { expectedToken: "", expectedTokenSha256: "" })).toBe(true);
  });
});

describe("isAuthorized — both forms configured", () => {
  const plain = "plain-token";
  const hashed = "hashed-token";
  const expectation = { expectedToken: plain, expectedTokenSha256: sha256Hex(hashed) };

  it("accepts the plaintext token", () => {
    expect(isAuthorized(bearer(plain), expectation)).toBe(true);
  });

  it("accepts the hash-matching token", () => {
    expect(isAuthorized(bearer(hashed), expectation)).toBe(true);
  });

  it("rejects an unrelated token", () => {
    expect(isAuthorized(bearer("neither"), expectation)).toBe(false);
  });
});

describe("isAuthorized — constant-time comparison", () => {
  /** SHA-256 digest size: the fixed width every comparison must run over. */
  const DIGEST_BYTES = 32;

  beforeEach(() => {
    timingSafeEqualOperandSizes.length = 0;
  });

  it("reaches the constant-time comparison whatever the presented length is", () => {
    // Each of these must reach timingSafeEqual. A length short-circuit would
    // skip the comparison for the mismatched lengths and drop the call count.
    expect(isAuthorized(bearer("x"), "a-much-longer-secret")).toBe(false);
    expect(isAuthorized(bearer("a-much-longer-provided-token"), "s")).toBe(false);
    expect(isAuthorized(bearer("secret"), "secret")).toBe(true);

    expect(timingSafeEqualOperandSizes).toEqual([
      [DIGEST_BYTES, DIGEST_BYTES],
      [DIGEST_BYTES, DIGEST_BYTES],
      [DIGEST_BYTES, DIGEST_BYTES],
    ]);
  });

  it("compares hashed mode over the same fixed width", () => {
    expect(isAuthorized(bearer("x"), { expectedTokenSha256: sha256Hex("real") })).toBe(false);
    expect(timingSafeEqualOperandSizes).toEqual([[DIGEST_BYTES, DIGEST_BYTES]]);
  });

  it("compares both configured forms at a fixed width", () => {
    const expectation = { expectedToken: "plain", expectedTokenSha256: sha256Hex("hashed") };
    expect(isAuthorized(bearer("neither-of-them"), expectation)).toBe(false);
    expect(timingSafeEqualOperandSizes).toEqual([
      [DIGEST_BYTES, DIGEST_BYTES],
      [DIGEST_BYTES, DIGEST_BYTES],
    ]);
  });
});

describe("createAuthHook", () => {
  it("allows health endpoint without auth", async () => {
    const hook = createAuthHook("secret");
    const reply = {
      status: () => reply,
      send: () => undefined,
    };
    await expect(
      hook(
        { url: "/health", headers: {} } as never,
        reply as never,
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects unauthorized request", async () => {
    let statusCode: number | undefined;
    let payload: unknown;
    const reply = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      send(body: unknown) {
        payload = body;
      },
    };
    const hook = createAuthHook("secret");
    await hook({ url: "/api/projects", headers: {} } as never, reply as never);

    expect(statusCode).toBe(401);
    expect(payload).toEqual({ error: "Unauthorized" });
  });

  it("accepts matching ?token= query param", async () => {
    const hook = createAuthHook("secret");
    const reply = {
      status: () => reply,
      send: () => undefined,
    };
    await expect(
      hook(
        { url: "/api/attachments/img.jpg", headers: {}, query: { token: "secret" } } as never,
        reply as never,
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects request with wrong ?token= query param", async () => {
    let statusCode: number | undefined;
    const reply = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      send() {},
    };
    const hook = createAuthHook("secret");
    await hook(
      { url: "/api/attachments/img.jpg", headers: {}, query: { token: "wrong" } } as never,
      reply as never,
    );
    expect(statusCode).toBe(401);
  });

  it("rejects a repeated ?token= query param instead of throwing", async () => {
    const { state, reply } = replyRecorder();
    const hook = createAuthHook("secret");
    await expect(
      hook(
        {
          url: "/api/attachments/img.jpg",
          headers: {},
          query: { token: ["secret", "other"] },
        } as never,
        reply as never,
      ),
    ).resolves.toBeUndefined();
    expect(state.statusCode).toBe(401);
    expect(state.payload).toEqual({ error: "Unauthorized" });
  });
});

describe("createAuthHook — hashed mode", () => {
  const token = "sk-hive-hook";
  const hash = sha256Hex(token);

  it("accepts a request whose bearer hashes to the expected hash", async () => {
    const { state, reply } = replyRecorder();
    const hook = createAuthHook({ expectedTokenSha256: hash });
    await hook({ url: "/api/projects", headers: bearer(token), query: {} } as never, reply as never);
    expect(state.statusCode).toBeUndefined();
  });

  it("accepts the matching ?token= query param", async () => {
    const { state, reply } = replyRecorder();
    const hook = createAuthHook({ expectedTokenSha256: hash });
    await hook(
      { url: "/api/attachments/img.jpg", headers: {}, query: { token } } as never,
      reply as never,
    );
    expect(state.statusCode).toBeUndefined();
  });

  it("rejects a request with a non-matching token", async () => {
    const { state, reply } = replyRecorder();
    const hook = createAuthHook({ expectedTokenSha256: hash });
    await hook(
      { url: "/api/projects", headers: bearer("wrong"), query: {} } as never,
      reply as never,
    );
    expect(state.statusCode).toBe(401);
  });

  it("keeps /health public", async () => {
    const { state, reply } = replyRecorder();
    const hook = createAuthHook({ expectedTokenSha256: hash });
    await hook({ url: "/health", headers: {}, query: {} } as never, reply as never);
    expect(state.statusCode).toBeUndefined();
  });

  it("is disabled when no expectation is configured", async () => {
    const { state, reply } = replyRecorder();
    const hook = createAuthHook({});
    await hook({ url: "/api/projects", headers: {}, query: {} } as never, reply as never);
    expect(state.statusCode).toBeUndefined();
  });
});

describe("isAllowedHostHeader", () => {
  it("allows IP literals, localhost, and MagicDNS names", () => {
    expect(isAllowedHostHeader("100.74.156.118:3000")).toBe(true);
    expect(isAllowedHostHeader("192.168.1.10")).toBe(true);
    expect(isAllowedHostHeader("localhost:3000")).toBe(true);
    expect(isAllowedHostHeader("[::1]:3000")).toBe(true);
    expect(isAllowedHostHeader("hive.tailnet-abc.ts.net:3000")).toBe(true);
  });

  it("rejects arbitrary domains (DNS rebinding) and missing hosts", () => {
    expect(isAllowedHostHeader("evil.example.com:3000")).toBe(false);
    expect(isAllowedHostHeader("attacker.io")).toBe(false);
    expect(isAllowedHostHeader("hive.example.ts.net.attacker.io")).toBe(false);
    expect(isAllowedHostHeader(undefined)).toBe(false);
    expect(isAllowedHostHeader("")).toBe(false);
  });

  it("honors the explicit allowlist, case-insensitively", () => {
    expect(isAllowedHostHeader("hive.mydomain.dev", ["hive.mydomain.dev"])).toBe(true);
    expect(isAllowedHostHeader("Hive.MyDomain.dev:3000", ["hive.mydomain.dev"])).toBe(true);
    expect(isAllowedHostHeader("other.mydomain.dev", ["hive.mydomain.dev"])).toBe(false);
  });
});

describe("allowedHostNames", () => {
  it("splits, trims and lowercases the configured list", () => {
    expect(allowedHostNames(" Hive.One.test , hive.two.test ,, ")).toEqual([
      "hive.one.test",
      "hive.two.test",
    ]);
  });

  it("returns an empty list when unset", () => {
    expect(allowedHostNames(undefined)).toEqual([]);
  });
});

describe("createHostGuardHook", () => {
  it("allows /health regardless of the Host header", async () => {
    const { state, reply } = replyRecorder();
    const hook = createHostGuardHook();
    await hook({ url: "/health", headers: { host: "hive.mydomain.dev" } } as never, reply as never);
    expect(state.statusCode).toBeUndefined();
  });

  it("allows an IP-literal Host header", async () => {
    const { state, reply } = replyRecorder();
    const hook = createHostGuardHook();
    await hook(
      { url: "/api/projects", headers: { host: "100.74.156.118:3000" } } as never,
      reply as never,
    );
    expect(state.statusCode).toBeUndefined();
  });

  it("rejects other routes with a disallowed Host header", async () => {
    const { state, reply } = replyRecorder();
    const hook = createHostGuardHook();
    await hook(
      { url: "/api/projects", headers: { host: "evil.example.com" } } as never,
      reply as never,
    );
    expect(state.statusCode).toBe(403);
    expect(state.payload).toEqual({ error: "Forbidden host" });
  });

  it("accepts a host from the configured allowlist", async () => {
    const { state, reply } = replyRecorder();
    const hook = createHostGuardHook(["hive.mydomain.dev"]);
    await hook(
      { url: "/api/projects", headers: { host: "hive.mydomain.dev" } } as never,
      reply as never,
    );
    expect(state.statusCode).toBeUndefined();
  });
});

describe("createWebSocketOriginGuardHook", () => {
  async function run(headers: Record<string, string>, url = "/ws/hub") {
    const { state, reply } = replyRecorder();
    await createWebSocketOriginGuardHook(new Set(["tauri://localhost"]))(
      { url, headers } as never,
      reply as never,
    );
    return state;
  }

  it("ignores non-upgrade requests and origin-less native upgrades", async () => {
    expect(
      (await run({ origin: "https://attacker.example" }, "/api/projects")).statusCode,
    ).toBeUndefined();
    expect((await run({ upgrade: "websocket" })).statusCode).toBeUndefined();
  });

  it("allows exact trusted origins and rejects all others", async () => {
    expect(
      (await run({ upgrade: "websocket", origin: "tauri://localhost" })).statusCode,
    ).toBeUndefined();
    expect(await run({ upgrade: "websocket", origin: "https://attacker.example" })).toEqual({
      statusCode: 403,
      payload: { error: "Forbidden origin" },
    });
  });

  it("never blocks /health", async () => {
    expect(
      (await run({ origin: "https://attacker.example" }, "/health")).statusCode,
    ).toBeUndefined();
  });

  async function buildWsApp(origins: ReadonlySet<string>) {
    const app = Fastify();
    await app.register(cors, {
      origin: (origin, callback) => {
        callback(null, origin === undefined || origins.has(origin));
      },
    });
    await app.register(websocket);
    app.addHook("onRequest", createWebSocketOriginGuardHook(origins));
    app.get("/ws", { websocket: true }, () => {});
    await app.ready();
    return app;
  }

  it("rejects an attacker origin before the WebSocket upgrade", async () => {
    const app = await buildWsApp(allowedBrowserOrigins("production", ""));
    try {
      await expect(
        app.injectWS("/ws", { headers: { origin: "https://attacker.example" } }),
      ).rejects.toThrow("Unexpected server response: 403");
    } finally {
      await app.close();
    }
  });

  it("accepts origin-less native clients and trusted Tauri origins", async () => {
    const app = await buildWsApp(allowedBrowserOrigins("production", ""));
    try {
      const native = await app.injectWS("/ws");
      native.close();
      const tauri = await app.injectWS("/ws", { headers: { origin: "tauri://localhost" } });
      tauri.close();
    } finally {
      await app.close();
    }
  });

  it("accepts an exact configured origin but no lookalike", async () => {
    const app = await buildWsApp(allowedBrowserOrigins("production", "https://hive.example.com"));
    try {
      const configured = await app.injectWS("/ws", {
        headers: { origin: "https://hive.example.com" },
      });
      configured.close();
      await expect(
        app.injectWS("/ws", { headers: { origin: "https://hive.example.com.attacker.test" } }),
      ).rejects.toThrow("Unexpected server response: 403");
    } finally {
      await app.close();
    }
  });
});

describe("allowedBrowserOrigins", () => {
  it("always trusts the Tauri webview origins", () => {
    const origins = allowedBrowserOrigins("production", "");
    expect(origins.has("tauri://localhost")).toBe(true);
    expect(origins.has("http://tauri.localhost")).toBe(true);
    expect(origins.has("https://tauri.localhost")).toBe(true);
  });

  it("adds dev-server origins only outside production", () => {
    expect(allowedBrowserOrigins("development", "").has("http://localhost:5173")).toBe(true);
    expect(allowedBrowserOrigins("production", "").has("http://localhost:5173")).toBe(false);
  });

  it("trims comma-separated configured origins", () => {
    const origins = allowedBrowserOrigins("production", " https://one.test,https://two.test ");
    expect(origins.has("https://one.test")).toBe(true);
    expect(origins.has("https://two.test")).toBe(true);
  });
});
