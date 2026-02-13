import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useVpsTarget } from "@/hooks/useVpsTarget";

describe("useVpsTarget", () => {
  beforeEach(() => {
    localStorage.removeItem("hive-vps-target");
  });

  it("returns empty value when no VPS target is configured", () => {
    const { result } = renderHook(() => useVpsTarget());
    expect(result.current.vpsTarget).toBe("");
  });

  it("stores a trimmed VPS target", () => {
    const { result } = renderHook(() => useVpsTarget());

    act(() => {
      result.current.setVpsTarget("  user@192.168.1.1  ");
    });

    expect(localStorage.getItem("hive-vps-target")).toBe("user@192.168.1.1");
    expect(result.current.vpsTarget).toBe("user@192.168.1.1");
  });

  it("removes the configured VPS target when set to empty value", () => {
    localStorage.setItem("hive-vps-target", "user@192.168.1.1");
    const { result } = renderHook(() => useVpsTarget());

    act(() => {
      result.current.setVpsTarget("   ");
    });

    expect(localStorage.getItem("hive-vps-target")).toBeNull();
    expect(result.current.vpsTarget).toBe("");
  });

  it("syncs updates across multiple hook subscribers", () => {
    const first = renderHook(() => useVpsTarget());
    const second = renderHook(() => useVpsTarget());

    act(() => {
      first.result.current.setVpsTarget("deploy@vps");
    });

    expect(second.result.current.vpsTarget).toBe("deploy@vps");
  });
});
