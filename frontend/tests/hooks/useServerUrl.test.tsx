import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { getServerUrl, useServerUrl } from "@/hooks/useServerUrl";

describe("useServerUrl", () => {
  beforeEach(() => {
    localStorage.removeItem("hive-server-url");
  });

  it("returns empty value when no server URL is configured", () => {
    const { result } = renderHook(() => useServerUrl());

    expect(result.current.serverUrl).toBe("");
    expect(getServerUrl()).toBe("");
  });

  it("stores a trimmed URL without trailing slashes", () => {
    const { result } = renderHook(() => useServerUrl());

    act(() => {
      result.current.setServerUrl("  http://localhost:4000///  ");
    });

    expect(localStorage.getItem("hive-server-url")).toBe("http://localhost:4000");
    expect(result.current.serverUrl).toBe("http://localhost:4000");
    expect(getServerUrl()).toBe("http://localhost:4000");
  });

  it("removes the configured URL when set to empty value", () => {
    localStorage.setItem("hive-server-url", "http://localhost:3000");
    const { result } = renderHook(() => useServerUrl());

    act(() => {
      result.current.setServerUrl("   ");
    });

    expect(localStorage.getItem("hive-server-url")).toBeNull();
    expect(result.current.serverUrl).toBe("");
    expect(getServerUrl()).toBe("");
  });

  it("syncs updates across multiple hook subscribers", () => {
    const first = renderHook(() => useServerUrl());
    const second = renderHook(() => useServerUrl());

    act(() => {
      first.result.current.setServerUrl("http://localhost:9000");
    });

    expect(second.result.current.serverUrl).toBe("http://localhost:9000");
  });
});
