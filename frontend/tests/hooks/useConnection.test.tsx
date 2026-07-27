import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  CONNECTION_STORAGE_KEY,
  getAuthToken,
  getConnection,
  getServerUrl,
  replaceConnection,
  serverUrlFor,
  useConnection,
} from "@/hooks/useConnection";

describe("connection store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stores and publishes the complete record atomically", () => {
    const first = renderHook(() => useConnection());
    const second = renderHook(() => useConnection());

    act(() => {
      first.result.current.setConnection({
        host: "100.64.0.10",
        port: 3000,
        authToken: "secret",
        sshUser: "hive",
        adminUser: "root",
      });
    });

    expect(second.result.current.connection).toEqual({
      host: "100.64.0.10",
      port: 3000,
      authToken: "secret",
      sshUser: "hive",
      adminUser: "root",
    });
    expect(second.result.current.isConfigured).toBe(true);
    expect(getServerUrl()).toBe("http://100.64.0.10:3000");
    expect(getAuthToken()).toBe("secret");
    // One record, one key — nothing else is written.
    expect(localStorage).toHaveLength(1);
  });

  it("keeps the SSH service account and the admin login apart", () => {
    replaceConnection({ host: "h", port: 3000, sshUser: "hive", adminUser: "root" });
    const stored = getConnection();

    expect(stored?.sshUser).toBe("hive");
    expect(stored?.adminUser).toBe("root");
  });

  it("removes the record and reports nothing configured", () => {
    replaceConnection({ host: "100.64.0.10", port: 3000 });
    replaceConnection(null);

    expect(getConnection()).toBeNull();
    expect(getServerUrl()).toBe("");
    expect(getAuthToken()).toBe("");
    expect(localStorage.getItem(CONNECTION_STORAGE_KEY)).toBeNull();
  });

  // ── Validation on read ──────────────────────────────────────────────────

  it.each([
    ["invalid JSON", "{not json"],
    ["a non-object", '"http://host:3000"'],
    ["a missing host", JSON.stringify({ port: 3000 })],
    ["a blank host", JSON.stringify({ host: "   ", port: 3000 })],
    ["a missing port", JSON.stringify({ host: "100.64.0.10" })],
    ["a string port", JSON.stringify({ host: "100.64.0.10", port: "3000" })],
    ["a fractional port", JSON.stringify({ host: "100.64.0.10", port: 30.5 })],
    ["an out-of-range port", JSON.stringify({ host: "100.64.0.10", port: 70000 })],
  ])("treats %s as no server configured", (_label, raw) => {
    localStorage.setItem(CONNECTION_STORAGE_KEY, raw);

    expect(getConnection()).toBeNull();
    expect(getServerUrl()).toBe("");
    expect(getAuthToken()).toBe("");
    expect(renderHook(() => useConnection()).result.current.isConfigured).toBe(false);
  });

  it("drops a token that is only whitespace rather than sending it", () => {
    localStorage.setItem(
      CONNECTION_STORAGE_KEY,
      JSON.stringify({ host: "100.64.0.10", port: 3000, authToken: "   " }),
    );

    expect(getConnection()).toEqual({ host: "100.64.0.10", port: 3000 });
    expect(getAuthToken()).toBe("");
  });

  // ── Derived URL ─────────────────────────────────────────────────────────

  it("omits the port when it is the protocol default", () => {
    expect(serverUrlFor({ host: "example.com", port: 80 })).toBe("http://example.com");
    expect(serverUrlFor({ host: "example.com", port: 443, protocol: "https" }))
      .toBe("https://example.com");
  });

  it("keeps a non-default port for both protocols", () => {
    expect(serverUrlFor({ host: "example.com", port: 443 })).toBe("http://example.com:443");
    expect(serverUrlFor({ host: "example.com", port: 80, protocol: "https" }))
      .toBe("https://example.com:80");
    expect(serverUrlFor({ host: "example.com", port: 3000 })).toBe("http://example.com:3000");
  });

  it("bracket-wraps IPv6 literals exactly once", () => {
    expect(serverUrlFor({ host: "fd7a:115c:a1e0::1", port: 3000 }))
      .toBe("http://[fd7a:115c:a1e0::1]:3000");
    expect(serverUrlFor({ host: "[fd7a:115c:a1e0::1]", port: 3000 }))
      .toBe("http://[fd7a:115c:a1e0::1]:3000");
    expect(serverUrlFor({ host: "::1", port: 443, protocol: "https" })).toBe("https://[::1]");
  });

  it("resolves an empty URL when nothing is configured", () => {
    expect(serverUrlFor(null)).toBe("");
  });
});
