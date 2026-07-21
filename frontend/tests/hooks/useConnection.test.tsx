import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONNECTION_STORAGE_KEY,
  getAuthToken,
  getConnection,
  getServerUrl,
  replaceConnection,
  useConnection,
} from "@/hooks/useConnection";

describe("connection store", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllEnvs();
  });

  it("stores and publishes the complete connection atomically", () => {
    const first = renderHook(() => useConnection());
    const second = renderHook(() => useConnection());

    act(() => {
      first.result.current.setConnection({
        host: "100.64.0.10",
        port: 3000,
        sshUser: "root",
        authToken: "secret",
      });
    });

    expect(second.result.current.connection).toEqual({
      host: "100.64.0.10",
      port: 3000,
      sshUser: "root",
      authToken: "secret",
    });
    expect(getServerUrl()).toBe("http://100.64.0.10:3000");
    expect(getAuthToken()).toBe("secret");
    expect(localStorage).toHaveLength(1);
  });

  it("migrates legacy keys once and preserves HTTPS and credentials", () => {
    localStorage.setItem("hive-server-url", "https://api.example.com");
    localStorage.setItem("hive-ssh-user", "ubuntu");
    localStorage.setItem("hive-auth-token", "legacy-token");

    expect(getConnection()).toEqual({
      host: "api.example.com",
      port: 443,
      protocol: "https",
      sshUser: "ubuntu",
      authToken: "legacy-token",
    });
    expect(getServerUrl()).toBe("https://api.example.com");
    expect(localStorage.getItem(CONNECTION_STORAGE_KEY)).not.toBeNull();
    expect(localStorage.getItem("hive-server-url")).toBeNull();
    expect(localStorage.getItem("hive-auth-token")).toBeNull();
  });

  it("formats IPv6 hosts and removes the complete connection", () => {
    replaceConnection({ host: "fd7a:115c:a1e0::1", port: 3000 });
    expect(getServerUrl()).toBe("http://[fd7a:115c:a1e0::1]:3000");

    replaceConnection(null);
    expect(getConnection()).toBeNull();
    expect(getServerUrl()).toBe("");
  });

  it("uses the build-time token only when the connection has no token", () => {
    vi.stubEnv("VITE_HIVE_AUTH_TOKEN", "seed-token");
    replaceConnection({ host: "localhost", port: 3000 });
    expect(getAuthToken()).toBe("seed-token");

    replaceConnection({ host: "localhost", port: 3000, authToken: "runtime-token" });
    expect(getAuthToken()).toBe("runtime-token");
  });
});
