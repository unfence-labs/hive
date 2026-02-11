import { describe, expect, it } from "vitest";
import { createAuthHook, extractAuthToken, isAuthorized } from "./auth.js";

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
});
