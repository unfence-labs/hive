import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ACCENT_OPTIONS, initAccentColor, useAccentColor } from "@/hooks/useAccentColor";

function currentAccent(): string {
  return document.documentElement.style.getPropertyValue("--hive-accent");
}

describe("accent color store", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.style.removeProperty("--hive-accent");
  });

  it("applies the stored accent at startup", () => {
    localStorage.setItem("hive-accent", "emerald");

    initAccentColor();

    expect(currentAccent()).toBe("#10b981");
  });

  it("falls back to the default accent when nothing is stored", () => {
    initAccentColor();

    expect(currentAccent()).toBe(ACCENT_OPTIONS[0].color);
  });

  it("ignores an unknown stored accent id", () => {
    localStorage.setItem("hive-accent", "chartreuse");

    initAccentColor();

    expect(currentAccent()).toBe(ACCENT_OPTIONS[0].color);
  });

  it("persists a selection and publishes it to every subscriber", () => {
    const first = renderHook(() => useAccentColor());
    const second = renderHook(() => useAccentColor());

    act(() => {
      first.result.current.setAccent("rose");
    });

    expect(localStorage.getItem("hive-accent")).toBe("rose");
    expect(currentAccent()).toBe("#f43f5e");
    expect(second.result.current.accentId).toBe("rose");
    expect(second.result.current.current.label).toBe("Rose");
  });
});
