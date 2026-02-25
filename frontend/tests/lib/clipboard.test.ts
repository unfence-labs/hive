import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard } from "@/lib/clipboard";

describe("copyToClipboard", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("uses navigator.clipboard.writeText when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const execCommand = vi.fn();
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    await copyToClipboard("hello");

    expect(writeText).toHaveBeenCalledWith("hello");
    expect(execCommand).not.toHaveBeenCalled();
    expect(document.querySelector("textarea")).not.toBeInTheDocument();
  });

  it("creates a hidden textarea with the copied text in fallback mode", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });
    const appendChildSpy = vi.spyOn(document.body, "appendChild");

    await copyToClipboard("hidden payload");

    const textarea = appendChildSpy.mock.calls[0]?.[0] as HTMLTextAreaElement | undefined;
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(textarea).toBeDefined();
    expect(textarea?.tagName).toBe("TEXTAREA");
    expect(textarea?.value).toBe("hidden payload");
    expect(textarea?.style.position).toBe("fixed");
    expect(textarea?.style.left).toBe("-9999px");
    expect(textarea?.style.top).toBe("-9999px");
  });
});
