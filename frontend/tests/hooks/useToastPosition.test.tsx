import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useToastPosition } from "@/hooks/useToastPosition";

describe("useToastPosition", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to bottom left when no valid preference exists", () => {
    localStorage.setItem("hive-toast-position", "middle");

    const { result } = renderHook(() => useToastPosition());

    expect(result.current.position).toBe("bottom-left");
  });

  it("persists position changes", () => {
    const { result } = renderHook(() => useToastPosition());

    act(() => result.current.setPosition("top-right"));

    expect(result.current.position).toBe("top-right");
    expect(localStorage.getItem("hive-toast-position")).toBe("top-right");
  });
});
