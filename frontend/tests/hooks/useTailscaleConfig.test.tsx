import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { getTailscaleConfig, useTailscaleConfig } from "@/hooks/useTailscaleConfig";

describe("useTailscaleConfig", () => {
  beforeEach(() => {
    localStorage.removeItem("hive-tailscale-ip");
    localStorage.removeItem("hive-tailscale-port");
    localStorage.removeItem("hive-server-url");
  });

  it("returns empty values when Tailscale config is missing", () => {
    const { result } = renderHook(() => useTailscaleConfig());

    expect(result.current.ip).toBe("");
    expect(result.current.port).toBe("");
    expect(result.current.isConfigured).toBe(false);
    expect(getTailscaleConfig()).toEqual({ ip: "", port: "", isConfigured: false });
  });

  it("stores a trimmed IP and keeps server URL empty until port exists", () => {
    const { result } = renderHook(() => useTailscaleConfig());

    act(() => {
      result.current.setIp(" 100.64.0.10 ");
    });

    expect(localStorage.getItem("hive-tailscale-ip")).toBe("100.64.0.10");
    expect(localStorage.getItem("hive-server-url")).toBeNull();
    expect(result.current.ip).toBe("100.64.0.10");
    expect(result.current.isConfigured).toBe(false);
  });

  it("stores a trimmed port and computes hive-server-url when IP exists", () => {
    localStorage.setItem("hive-tailscale-ip", "100.64.0.10");
    const { result } = renderHook(() => useTailscaleConfig());

    act(() => {
      result.current.setPort(" 3001 ");
    });

    expect(localStorage.getItem("hive-tailscale-port")).toBe("3001");
    expect(localStorage.getItem("hive-server-url")).toBe("http://100.64.0.10:3001");
    expect(result.current.port).toBe("3001");
    expect(result.current.isConfigured).toBe(true);
    expect(getTailscaleConfig()).toEqual({ ip: "100.64.0.10", port: "3001", isConfigured: true });
  });

  it("removes IP and computed server URL when IP is set to empty", () => {
    localStorage.setItem("hive-tailscale-ip", "100.64.0.10");
    localStorage.setItem("hive-tailscale-port", "3001");
    localStorage.setItem("hive-server-url", "http://100.64.0.10:3001");

    const { result } = renderHook(() => useTailscaleConfig());

    act(() => {
      result.current.setIp("   ");
    });

    expect(localStorage.getItem("hive-tailscale-ip")).toBeNull();
    expect(localStorage.getItem("hive-server-url")).toBeNull();
    expect(result.current.ip).toBe("");
    expect(result.current.isConfigured).toBe(false);
  });

  it("removes port and computed server URL when port is set to empty", () => {
    localStorage.setItem("hive-tailscale-ip", "100.64.0.10");
    localStorage.setItem("hive-tailscale-port", "3001");
    localStorage.setItem("hive-server-url", "http://100.64.0.10:3001");

    const { result } = renderHook(() => useTailscaleConfig());

    act(() => {
      result.current.setPort("   ");
    });

    expect(localStorage.getItem("hive-tailscale-port")).toBeNull();
    expect(localStorage.getItem("hive-server-url")).toBeNull();
    expect(result.current.port).toBe("");
    expect(result.current.isConfigured).toBe(false);
  });

  it("syncs updates across multiple hook subscribers", () => {
    const first = renderHook(() => useTailscaleConfig());
    const second = renderHook(() => useTailscaleConfig());

    act(() => {
      first.result.current.setIp("100.64.0.77");
      first.result.current.setPort("3000");
    });

    expect(second.result.current.ip).toBe("100.64.0.77");
    expect(second.result.current.port).toBe("3000");
    expect(second.result.current.isConfigured).toBe(true);
    expect(localStorage.getItem("hive-server-url")).toBe("http://100.64.0.77:3000");
  });
});
