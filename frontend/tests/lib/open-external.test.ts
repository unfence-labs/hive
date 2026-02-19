import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildVscodeRemoteUri, openExternal } from "@/lib/open-external";

const mocks = vi.hoisted(() => ({
  openUrl: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: mocks.openUrl,
}));

describe("buildVscodeRemoteUri", () => {
  it("encodes SSH host and each path segment", () => {
    const uri = buildVscodeRemoteUri(" user name@example-host ", " /Users/me/project folder ");

    expect(uri).toBe(
      "vscode://vscode-remote/ssh-remote+user%20name%40example-host/Users/me/project%20folder",
    );
  });

  it("normalizes windows separators and adds leading slash", () => {
    const uri = buildVscodeRemoteUri("root@100.64.0.10", "Users\\me\\repo");

    expect(uri).toBe("vscode://vscode-remote/ssh-remote+root%40100.64.0.10/Users/me/repo");
  });
});

describe("openExternal", () => {
  beforeEach(() => {
    mocks.openUrl.mockReset();
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  it("uses window.open for HTTP URLs in browser mode", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    await openExternal("https://example.com");

    expect(openSpy).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });

  it("uses Tauri opener when running in Tauri", async () => {
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    mocks.openUrl.mockResolvedValue(undefined);
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    await openExternal("vscode://vscode-remote/ssh-remote+host/path");

    expect(mocks.openUrl).toHaveBeenCalledWith("vscode://vscode-remote/ssh-remote+host/path");
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("falls back to browser behavior when Tauri opener throws", async () => {
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    mocks.openUrl.mockRejectedValue(new Error("plugin unavailable"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    await openExternal("https://example.com/docs");

    expect(warnSpy).toHaveBeenCalled();
    expect(openSpy).toHaveBeenCalledWith(
      "https://example.com/docs",
      "_blank",
      "noopener,noreferrer",
    );
  });
});
