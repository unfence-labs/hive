import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getAuthToken, useAuthToken } from "@/hooks/useAuthToken";

describe("useAuthToken", () => {
  beforeEach(() => {
    localStorage.removeItem("hive-auth-token");
  });
  afterEach(() => {
    delete import.meta.env.VITE_HIVE_AUTH_TOKEN;
    localStorage.removeItem("hive-auth-token");
  });

  it("returns empty when nothing configured", () => {
    const { result } = renderHook(() => useAuthToken());
    expect(result.current.authToken).toBe("");
    expect(getAuthToken()).toBe("");
  });

  it("stores a trimmed token", () => {
    const { result } = renderHook(() => useAuthToken());
    act(() => result.current.setAuthToken("  hive_abc  "));
    expect(localStorage.getItem("hive-auth-token")).toBe("hive_abc");
    expect(result.current.authToken).toBe("hive_abc");
    expect(getAuthToken()).toBe("hive_abc");
  });

  it("removes the token when set to empty", () => {
    localStorage.setItem("hive-auth-token", "hive_x");
    const { result } = renderHook(() => useAuthToken());
    act(() => result.current.setAuthToken("   "));
    expect(localStorage.getItem("hive-auth-token")).toBeNull();
    expect(getAuthToken()).toBe("");
  });

  it("falls back to the env seed only when no token is stored", () => {
    import.meta.env.VITE_HIVE_AUTH_TOKEN = "seed-token";
    expect(getAuthToken()).toBe("seed-token");
    const { result } = renderHook(() => useAuthToken());
    expect(result.current.authToken).toBe("seed-token");

    act(() => result.current.setAuthToken("runtime-token"));
    // Stored token wins over the env seed.
    expect(getAuthToken()).toBe("runtime-token");
    expect(result.current.authToken).toBe("runtime-token");
  });

  it("syncs across subscribers", () => {
    const first = renderHook(() => useAuthToken());
    const second = renderHook(() => useAuthToken());
    act(() => first.result.current.setAuthToken("shared"));
    expect(second.result.current.authToken).toBe("shared");
  });
});
