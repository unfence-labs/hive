import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  createAuthHook,
  createHostGuardHook,
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
});

describe("isAuthorized — hashed mode", () => {
  const token = "sk-ant-oat01-abcdef";
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

  it("is open when neither token nor hash is configured", () => {
    expect(isAuthorized({}, {})).toBe(true);
  });
});

describe("isAuthorized — both modes configured", () => {
  const plain = "plain-token";
  const other = "hashed-token";
  const expectation = { expectedToken: plain, expectedTokenSha256: sha256Hex(other) };

  it("accepts the plaintext token", () => {
    expect(isAuthorized(bearer(plain), expectation)).toBe(true);
  });
  it("accepts the hash-matching token", () => {
    expect(isAuthorized(bearer(other), expectation)).toBe(true);
  });
  it("rejects an unrelated token", () => {
    expect(isAuthorized(bearer("neither"), expectation)).toBe(false);
  });
});

describe("isAuthorized — timing safety", () => {
  it("rejects tokens of differing length without throwing", () => {
    expect(isAuthorized(bearer("short"), "a-much-longer-secret")).toBe(false);
    expect(isAuthorized(bearer("a-much-longer-provided-token"), "short")).toBe(false);
  });
  it("hashed compare is over fixed-length hex", () => {
    const hash = sha256Hex("real");
    expect(isAuthorized(bearer("x"), { expectedTokenSha256: hash })).toBe(false);
  });
});

describe("createAuthHook — hashed mode", () => {
  const token = "sk-ant-oat01-hook";
  const hash = sha256Hex(token);

  it("accepts a request whose bearer hashes to the expected hash", async () => {
    const hook = createAuthHook({ expectedTokenSha256: hash });
    let statusCode: number | undefined;
    const reply = {
      status(code: number) { statusCode = code; return this; },
      send() {},
    };
    await hook({ url: "/api/projects", headers: bearer(token), query: {} } as never, reply as never);
    expect(statusCode).toBeUndefined();
  });

  it("rejects a request with a non-matching token", async () => {
    const hook = createAuthHook({ expectedTokenSha256: hash });
    let statusCode: number | undefined;
    const reply = {
      status(code: number) { statusCode = code; return this; },
      send() {},
    };
    await hook({ url: "/api/projects", headers: bearer("wrong"), query: {} } as never, reply as never);
    expect(statusCode).toBe(401);
  });

  it("is disabled when no expectation is configured", async () => {
    const hook = createAuthHook({});
    let statusCode: number | undefined;
    const reply = {
      status(code: number) { statusCode = code; return this; },
      send() {},
    };
    await hook({ url: "/api/projects", headers: {}, query: {} } as never, reply as never);
    expect(statusCode).toBeUndefined();
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
    expect(isAllowedHostHeader(undefined)).toBe(false);
  });

  it("honors the explicit allowlist", () => {
    expect(isAllowedHostHeader("hive.mydomain.dev", ["hive.mydomain.dev"])).toBe(true);
  });
});

describe("createHostGuardHook", () => {
  function replyRecorder() {
    const state: { statusCode?: number } = {};
    return {
      state,
      reply: {
        status(code: number) { state.statusCode = code; return this; },
        send() {},
      },
    };
  }

  it("allows /health regardless of the Host header (matches the auth hook exemption)", async () => {
    const hook = createHostGuardHook();
    const { state, reply } = replyRecorder();
    await hook({ url: "/health", headers: { host: "hive.mydomain.dev" } } as never, reply as never);
    expect(state.statusCode).toBeUndefined();
  });

  it("rejects other routes with a disallowed Host header", async () => {
    const hook = createHostGuardHook();
    const { state, reply } = replyRecorder();
    await hook({ url: "/api/projects", headers: { host: "evil.example.com" } } as never, reply as never);
    expect(state.statusCode).toBe(403);
  });
});
