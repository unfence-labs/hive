import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { getTailscaleConfig, useTailscaleConfig } from "@/hooks/useTailscaleConfig";

describe("useTailscaleConfig", () => {
  beforeEach(() => {
    localStorage.removeItem("hive-tailscale-ip");
    localStorage.removeItem("hive-tailscale-port");
    localStorage.removeItem("hive-ssh-user");
    localStorage.removeItem("hive-server-url");
  });

  // ── Initial state ──────────────────────────────────────────────────────

  it("returns empty values when Tailscale config is missing", () => {
    const { result } = renderHook(() => useTailscaleConfig());

    expect(result.current.ip).toBe("");
    expect(result.current.port).toBe("");
    expect(result.current.sshUser).toBe("");
    expect(result.current.isConfigured).toBe(false);
    expect(getTailscaleConfig()).toEqual({ ip: "", port: "", sshUser: "", isConfigured: false });
  });

  it("hydrates from existing localStorage values", () => {
    localStorage.setItem("hive-tailscale-ip", "10.0.0.1");
    localStorage.setItem("hive-tailscale-port", "4000");
    localStorage.setItem("hive-ssh-user", "admin");

    const { result } = renderHook(() => useTailscaleConfig());

    expect(result.current.ip).toBe("10.0.0.1");
    expect(result.current.port).toBe("4000");
    expect(result.current.sshUser).toBe("admin");
    expect(result.current.isConfigured).toBe(true);
  });

  // ── IP ─────────────────────────────────────────────────────────────────

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

  // ── Port ───────────────────────────────────────────────────────────────

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
    expect(getTailscaleConfig()).toEqual({
      ip: "100.64.0.10",
      port: "3001",
      sshUser: "",
      isConfigured: true,
    });
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

  // ── SSH User ───────────────────────────────────────────────────────────

  it("stores a trimmed SSH user and exposes it through snapshots", () => {
    const { result } = renderHook(() => useTailscaleConfig());

    act(() => {
      result.current.setSshUser("  root  ");
    });

    expect(localStorage.getItem("hive-ssh-user")).toBe("root");
    expect(result.current.sshUser).toBe("root");
    expect(getTailscaleConfig()).toEqual({ ip: "", port: "", sshUser: "root", isConfigured: false });
  });

  it("removes SSH user when set to empty value", () => {
    localStorage.setItem("hive-ssh-user", "ubuntu");
    const { result } = renderHook(() => useTailscaleConfig());

    act(() => {
      result.current.setSshUser("   ");
    });

    expect(localStorage.getItem("hive-ssh-user")).toBeNull();
    expect(result.current.sshUser).toBe("");
    expect(getTailscaleConfig().sshUser).toBe("");
  });

  it("SSH user does not affect isConfigured status", () => {
    const { result } = renderHook(() => useTailscaleConfig());

    act(() => {
      result.current.setSshUser("root");
    });

    expect(result.current.isConfigured).toBe(false);

    act(() => {
      result.current.setIp("10.0.0.1");
      result.current.setPort("3000");
    });

    expect(result.current.isConfigured).toBe(true);
    expect(result.current.sshUser).toBe("root");
  });

  it("SSH user does not trigger server URL recomputation", () => {
    localStorage.setItem("hive-tailscale-ip", "10.0.0.1");
    localStorage.setItem("hive-tailscale-port", "3000");
    localStorage.setItem("hive-server-url", "http://10.0.0.1:3000");

    const { result } = renderHook(() => useTailscaleConfig());

    act(() => {
      result.current.setSshUser("devops");
    });

    // Server URL should remain unchanged
    expect(localStorage.getItem("hive-server-url")).toBe("http://10.0.0.1:3000");
  });

  // ── Cross-subscriber sync ─────────────────────────────────────────────

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

  it("syncs SSH user updates across multiple hook subscribers", () => {
    const first = renderHook(() => useTailscaleConfig());
    const second = renderHook(() => useTailscaleConfig());

    act(() => {
      first.result.current.setSshUser("developer");
    });

    expect(second.result.current.sshUser).toBe("developer");
  });

  // ── getTailscaleConfig (non-React) ─────────────────────────────────────

  it("getTailscaleConfig returns all fields including sshUser", () => {
    localStorage.setItem("hive-tailscale-ip", "10.0.0.1");
    localStorage.setItem("hive-tailscale-port", "4000");
    localStorage.setItem("hive-ssh-user", "ubuntu");

    const config = getTailscaleConfig();

    expect(config).toEqual({
      ip: "10.0.0.1",
      port: "4000",
      sshUser: "ubuntu",
      isConfigured: true,
    });
  });

  it("getTailscaleConfig reflects changes made via hook setters", () => {
    const { result } = renderHook(() => useTailscaleConfig());

    act(() => {
      result.current.setIp("192.168.1.1");
      result.current.setPort("8080");
      result.current.setSshUser("admin");
    });

    const config = getTailscaleConfig();
    expect(config.ip).toBe("192.168.1.1");
    expect(config.port).toBe("8080");
    expect(config.sshUser).toBe("admin");
    expect(config.isConfigured).toBe(true);
  });
});
