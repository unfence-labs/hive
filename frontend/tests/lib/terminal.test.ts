import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSshCommand, detectTerminals, openTerminalSsh } from "@/lib/terminal";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

describe("buildSshCommand", () => {
  it("builds a basic SSH command", () => {
    const cmd = buildSshCommand("user@host", "/home/user/project");
    expect(cmd).toBe(
      'ssh user@host -t "cd \'/home/user/project\' && exec \\$SHELL -l"',
    );
  });

  it("escapes single quotes in the remote path", () => {
    const cmd = buildSshCommand("root@10.0.0.1", "/home/it's a project");
    expect(cmd).toBe(
      "ssh root@10.0.0.1 -t \"cd '/home/it'\\''s a project' && exec \\$SHELL -l\"",
    );
  });

  it("handles paths with spaces", () => {
    const cmd = buildSshCommand("dev@host", "/Users/me/my project");
    expect(cmd).toContain("cd '/Users/me/my project'");
  });

  it("escapes $SHELL so it expands on the remote", () => {
    const cmd = buildSshCommand("user@host", "/path");
    expect(cmd).toContain("\\$SHELL");
    expect(cmd).not.toContain("exec $SHELL");
  });

  it("handles host without user prefix", () => {
    const cmd = buildSshCommand("100.64.0.10", "/srv/hive/tokyo");
    expect(cmd).toBe(
      'ssh 100.64.0.10 -t "cd \'/srv/hive/tokyo\' && exec \\$SHELL -l"',
    );
  });
});

describe("detectTerminals", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("returns empty array in browser mode", async () => {
    const result = await detectTerminals();
    expect(result).toEqual([]);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("calls Tauri invoke in Tauri mode", async () => {
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    mocks.invoke.mockResolvedValue([{ id: "terminal_app", name: "Terminal" }]);

    const result = await detectTerminals();

    expect(mocks.invoke).toHaveBeenCalledWith("detect_terminals");
    expect(result).toEqual([{ id: "terminal_app", name: "Terminal" }]);
  });

  it("returns empty array when invoke throws", async () => {
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    mocks.invoke.mockRejectedValue(new Error("not available"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await detectTerminals();

    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe("openTerminalSsh", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  it("invokes open_terminal_ssh with built command", async () => {
    mocks.invoke.mockResolvedValue(undefined);

    await openTerminalSsh("iterm2", "user@host", "/path/to/workspace");

    expect(mocks.invoke).toHaveBeenCalledWith("open_terminal_ssh", {
      terminalId: "iterm2",
      command: 'ssh user@host -t "cd \'/path/to/workspace\' && exec \\$SHELL -l"',
    });
  });
});
