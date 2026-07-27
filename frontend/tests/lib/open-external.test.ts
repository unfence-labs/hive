import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildVscodeRemoteUri, openExternal } from "@/lib/open-external";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError },
}));

// ─── buildVscodeRemoteUri ────────────────────────────────────────────────────

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

  it("produces a valid URI for simple host and absolute path", () => {
    const uri = buildVscodeRemoteUri("root@10.0.0.1", "/srv/hive/tokyo");

    expect(uri).toBe("vscode://vscode-remote/ssh-remote+root%4010.0.0.1/srv/hive/tokyo");
  });

  it("handles host without user@ prefix", () => {
    const uri = buildVscodeRemoteUri("100.64.0.77", "/home/dev/project");

    expect(uri).toBe("vscode://vscode-remote/ssh-remote+100.64.0.77/home/dev/project");
  });

  it("handles path that already has a leading slash", () => {
    const uri = buildVscodeRemoteUri("host", "/absolute/path");

    expect(uri).toBe("vscode://vscode-remote/ssh-remote+host/absolute/path");
    // Should not double the leading slash
    expect(uri).not.toContain("//absolute");
  });

  it("adds leading slash when path has none", () => {
    const uri = buildVscodeRemoteUri("host", "relative/path");

    expect(uri).toBe("vscode://vscode-remote/ssh-remote+host/relative/path");
  });

  it("encodes special characters in path segments", () => {
    const uri = buildVscodeRemoteUri("h", "/path/with spaces/and#hash/and@at");

    expect(uri).toContain("with%20spaces");
    expect(uri).toContain("and%23hash");
    expect(uri).toContain("and%40at");
  });

  it("encodes unicode characters in host and path", () => {
    const uri = buildVscodeRemoteUri("u@hôst", "/données/projet");

    expect(uri).toContain("h%C3%B4st");
    expect(uri).toContain("donn%C3%A9es");
  });

  it("handles root path /", () => {
    const uri = buildVscodeRemoteUri("host", "/");

    expect(uri).toBe("vscode://vscode-remote/ssh-remote+host/");
  });

  it("trims whitespace from both host and path", () => {
    const uri = buildVscodeRemoteUri("  host  ", "  /path  ");

    expect(uri).toBe("vscode://vscode-remote/ssh-remote+host/path");
  });

  it("encodes + signs in host (user+tag@host)", () => {
    const uri = buildVscodeRemoteUri("user+tag@host", "/p");

    expect(uri).toContain("user%2Btag%40host");
  });

  it("encodes colons in host (for IPv6-like hosts)", () => {
    const uri = buildVscodeRemoteUri("user@[::1]", "/p");

    expect(uri).toContain("user%40%5B%3A%3A1%5D");
  });

  it("handles empty path after trim (becomes just /)", () => {
    const uri = buildVscodeRemoteUri("host", "   ");

    expect(uri).toBe("vscode://vscode-remote/ssh-remote+host/");
  });

  it("preserves path hierarchy with deeply nested paths", () => {
    const uri = buildVscodeRemoteUri("h", "/a/b/c/d/e/f");

    expect(uri).toBe("vscode://vscode-remote/ssh-remote+h/a/b/c/d/e/f");
  });

  it("handles mixed backslash and forward slash path", () => {
    const uri = buildVscodeRemoteUri("h", "C:\\Users\\dev/projects\\my-app");

    expect(uri).toBe("vscode://vscode-remote/ssh-remote+h/C%3A/Users/dev/projects/my-app");
  });
});

// ─── openExternal ────────────────────────────────────────────────────────────

describe("openExternal", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  // ── Browser mode ──────────────────────────────────────────────────────

  it("uses window.open for HTTP URLs in browser mode", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    await openExternal("https://example.com");

    expect(openSpy).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("uses window.open for http:// (lowercase) in browser mode", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    await openExternal("http://localhost:3000");

    expect(openSpy).toHaveBeenCalledWith("http://localhost:3000", "_blank", "noopener,noreferrer");
  });

  it("uses window.open for HTTPS:// (uppercase) in browser mode", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    await openExternal("HTTPS://EXAMPLE.COM");

    expect(openSpy).toHaveBeenCalledWith("HTTPS://EXAMPLE.COM", "_blank", "noopener,noreferrer");
  });

  it("uses location.assign for non-HTTP URLs in browser mode (vscode://)", async () => {
    const assignFn = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign: assignFn },
      writable: true,
      configurable: true,
    });
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    await openExternal("vscode://vscode-remote/ssh-remote+host/path");

    expect(assignFn).toHaveBeenCalledWith("vscode://vscode-remote/ssh-remote+host/path");
    expect(openSpy).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("uses location.assign for non-HTTP URLs in browser mode (custom://)", async () => {
    const assignFn = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign: assignFn },
      writable: true,
      configurable: true,
    });

    await openExternal("custom-app://deep/link");

    expect(assignFn).toHaveBeenCalledWith("custom-app://deep/link");
  });

  it("does not call Tauri opener in browser mode", async () => {
    vi.spyOn(window, "open").mockImplementation(() => null);

    await openExternal("https://example.com");

    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  // ── Tauri mode ────────────────────────────────────────────────────────

  it("uses Tauri opener when running in Tauri", async () => {
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    mocks.invoke.mockResolvedValue(undefined);
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    await openExternal("vscode://vscode-remote/ssh-remote+host/path");

    expect(mocks.invoke).toHaveBeenCalledWith("plugin:opener|open_url", {
      url: "vscode://vscode-remote/ssh-remote+host/path",
    });
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("uses Tauri opener for HTTP URLs in Tauri mode", async () => {
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    mocks.invoke.mockResolvedValue(undefined);

    await openExternal("https://github.com");

    expect(mocks.invoke).toHaveBeenCalledWith("plugin:opener|open_url", { url: "https://github.com" });
  });

  // ── Tauri fallback ────────────────────────────────────────────────────

  it("surfaces a toast carrying the URL when the Tauri opener throws", async () => {
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    mocks.invoke.mockRejectedValue(new Error("plugin unavailable"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    await openExternal("https://example.com/docs");

    expect(warnSpy).toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Couldn't open the browser",
      expect.objectContaining({
        description: expect.stringContaining("https://example.com/docs"),
      }),
    );
    // A window.open fallback is silently dropped inside a Tauri webview.
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("logs warning with original error when Tauri opener fails", async () => {
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const cause = new Error("no permission");
    mocks.invoke.mockRejectedValue(cause);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(window, "open").mockImplementation(() => null);

    await openExternal("https://example.com");

    expect(warnSpy).toHaveBeenCalledWith(
      "Failed to open external URL via Tauri opener:",
      cause,
    );
  });

  // ── Protocol detection edge cases ─────────────────────────────────────

  it("treats ftp:// as non-HTTP in browser mode", async () => {
    const assignFn = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign: assignFn },
      writable: true,
      configurable: true,
    });

    await openExternal("ftp://files.example.com/doc.pdf");

    expect(assignFn).toHaveBeenCalledWith("ftp://files.example.com/doc.pdf");
  });

  it("treats mailto: as non-HTTP in browser mode", async () => {
    const assignFn = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign: assignFn },
      writable: true,
      configurable: true,
    });

    await openExternal("mailto:test@example.com");

    expect(assignFn).toHaveBeenCalledWith("mailto:test@example.com");
  });

  it("treats vscode-insiders:// as non-HTTP in browser mode", async () => {
    const assignFn = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign: assignFn },
      writable: true,
      configurable: true,
    });

    await openExternal("vscode-insiders://vscode-remote/ssh-remote+host/p");

    expect(assignFn).toHaveBeenCalledWith("vscode-insiders://vscode-remote/ssh-remote+host/p");
  });
});
