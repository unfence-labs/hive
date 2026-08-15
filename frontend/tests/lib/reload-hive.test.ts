import { describe, expect, it, vi } from "vitest";
import { reloadHive } from "@/lib/reload-hive";

describe("reloadHive", () => {
  it("reloads the current window", () => {
    const locationDescriptor = Object.getOwnPropertyDescriptor(window, "location");
    const reload = vi.fn();

    Object.defineProperty(window, "location", {
      value: { ...window.location, reload },
      configurable: true,
    });

    try {
      reloadHive();
      expect(reload).toHaveBeenCalledOnce();
    } finally {
      if (locationDescriptor) Object.defineProperty(window, "location", locationDescriptor);
    }
  });
});
