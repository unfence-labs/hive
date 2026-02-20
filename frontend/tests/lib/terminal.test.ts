import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSshCommand, detectTerminals, openTerminalSsh } from "@/lib/terminal";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

// ─── buildSshCommand ─────────────────────────────────────────────────────────

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

  it("forces a pseudo-terminal with -t flag", () => {
    const cmd = buildSshCommand("user@host", "/p");
    expect(cmd).toMatch(/^ssh .+ -t "/);
  });

  it("wraps the remote command in double quotes", () => {
    const cmd = buildSshCommand("user@host", "/p");
    // The cd ... && exec part should be inside double quotes
    expect(cmd).toMatch(/-t "cd .+ && exec .+"/);
  });

  it("single-quotes the remote path to prevent shell expansion", () => {
    const cmd = buildSshCommand("user@host", "/home/$USER/project");
    // $USER should be inside single quotes, not expanded
    expect(cmd).toContain("cd '/home/$USER/project'");
  });

  it("handles paths with backticks", () => {
    const cmd = buildSshCommand("user@host", "/home/user/`weird`/project");
    // Backticks are inside single quotes, so they won't be expanded
    expect(cmd).toContain("cd '/home/user/`weird`/project'");
  });

  it("handles paths with double quotes", () => {
    const cmd = buildSshCommand("user@host", '/home/user/"quoted"/project');
    // Double quotes inside single-quoted strings are literal
    expect(cmd).toContain('cd \'/home/user/"quoted"/project\'');
  });

  it("handles paths with multiple consecutive single quotes", () => {
    const cmd = buildSshCommand("user@host", "/home/it''s");
    expect(cmd).toContain("'\\''");
  });

  it("handles empty path", () => {
    const cmd = buildSshCommand("user@host", "");
    expect(cmd).toBe('ssh user@host -t "cd \'\' && exec \\$SHELL -l"');
  });

  it("handles path with only a slash", () => {
    const cmd = buildSshCommand("user@host", "/");
    expect(cmd).toBe('ssh user@host -t "cd \'/\' && exec \\$SHELL -l"');
  });

  it("preserves the full command structure for osascript consumption", () => {
    const cmd = buildSshCommand("dev@10.0.0.1", "/srv/hive/workspace");
    // The command should be a single string suitable for passing to a terminal
    expect(cmd).toBe(
      'ssh dev@10.0.0.1 -t "cd \'/srv/hive/workspace\' && exec \\$SHELL -l"',
    );
  });
});

// ─── detectTerminals ─────────────────────────────────────────────────────────

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

  it("logs the error message when detection fails", async () => {
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const error = new Error("command not registered");
    mocks.invoke.mockRejectedValue(error);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await detectTerminals();

    expect(warnSpy).toHaveBeenCalledWith("Failed to detect terminals:", error);
  });

  it("returns multiple terminals when detected", async () => {
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const apps = [
      { id: "terminal_app", name: "Terminal" },
      { id: "iterm2", name: "iTerm" },
    ];
    mocks.invoke.mockResolvedValue(apps);

    const result = await detectTerminals();

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("terminal_app");
    expect(result[1].id).toBe("iterm2");
  });

  it("returns empty array when Tauri returns empty list", async () => {
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    mocks.invoke.mockResolvedValue([]);

    const result = await detectTerminals();

    expect(result).toEqual([]);
  });

  it("does not call invoke more than once per call", async () => {
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    mocks.invoke.mockResolvedValue([]);

    await detectTerminals();
    await detectTerminals();

    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });
});

// ─── openTerminalSsh ─────────────────────────────────────────────────────────

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

  it("passes terminal_app as terminalId", async () => {
    mocks.invoke.mockResolvedValue(undefined);

    await openTerminalSsh("terminal_app", "root@10.0.0.1", "/srv/hive/kyoto");

    expect(mocks.invoke).toHaveBeenCalledWith("open_terminal_ssh", {
      terminalId: "terminal_app",
      command: 'ssh root@10.0.0.1 -t "cd \'/srv/hive/kyoto\' && exec \\$SHELL -l"',
    });
  });

  it("propagates errors from invoke", async () => {
    mocks.invoke.mockRejectedValue(new Error("Unknown terminal: wezterm"));

    await expect(
      openTerminalSsh("wezterm", "user@host", "/p"),
    ).rejects.toThrow("Unknown terminal: wezterm");
  });

  it("escapes single quotes in path passed to invoke", async () => {
    mocks.invoke.mockResolvedValue(undefined);

    await openTerminalSsh("iterm2", "user@host", "/home/it's here");

    expect(mocks.invoke).toHaveBeenCalledWith("open_terminal_ssh", {
      terminalId: "iterm2",
      command: "ssh user@host -t \"cd '/home/it'\\''s here' && exec \\$SHELL -l\"",
    });
  });

  it("uses buildSshCommand internally (command structure matches)", async () => {
    mocks.invoke.mockResolvedValue(undefined);

    await openTerminalSsh("terminal_app", "dev@100.64.0.77", "/workspace/path");

    const call = mocks.invoke.mock.calls[0];
    expect(call[0]).toBe("open_terminal_ssh");
    expect(call[1].command).toMatch(/^ssh dev@100\.64\.0\.77 -t "cd '\/workspace\/path' && exec \\\$SHELL -l"$/);
  });
});
