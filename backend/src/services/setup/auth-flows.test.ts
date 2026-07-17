import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, chmod, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isValidClaudeToken, makeClaudeTokenWriter } from "./auth-flows.js";
import type { InstallerDeps, RunCommand } from "./installers/command.js";

describe("isValidClaudeToken", () => {
  it("accepts a well-formed OAuth token", () => {
    expect(isValidClaudeToken("sk-ant-oat01-abc123")).toBe(true);
  });
  it("rejects a bad prefix or empty body", () => {
    expect(isValidClaudeToken("nope")).toBe(false);
    expect(isValidClaudeToken("sk-ant-oat01-")).toBe(false);
    expect(isValidClaudeToken("")).toBe(false);
  });
});

describe("makeClaudeTokenWriter", () => {
  let helpersDir: string;

  beforeEach(async () => {
    helpersDir = await mkdtemp(join(tmpdir(), "hive-helpers-"));
  });
  afterEach(async () => {
    await rm(helpersDir, { recursive: true, force: true });
  });

  function deps(run: RunCommand, available = true): InstallerDeps {
    return { run, helpersAvailable: async () => available, helpersDir };
  }

  it("no-ops (persisted:false) when helpers are unavailable (off-server)", async () => {
    const run = vi.fn();
    const writer = makeClaudeTokenWriter(deps(run as unknown as RunCommand, false));
    const result = await writer("sk-ant-oat01-abc");
    expect(result).toEqual({ persisted: false });
    expect(run).not.toHaveBeenCalled();
  });

  it("writes the env line via a real helper standing in for /etc/hive", async () => {
    // A real bash helper that writes CLAUDE_CODE_OAUTH_TOKEN into an env file in
    // the temp dir, emulating the privileged write-claude-token.sh.
    const envFile = join(helpersDir, "hive.env");
    const helperPath = join(helpersDir, "write-claude-token.sh");
    await writeFile(
      helperPath,
      `#!/usr/bin/env bash
set -eu
printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\\n' "$1" > "${envFile}"
chmod 600 "${envFile}"
`,
      "utf-8",
    );
    await chmod(helperPath, 0o755);

    // Run without `sudo` in the test (no privileges needed for the temp dir):
    // strip a leading "sudo " so the helper executes directly.
    const run: RunCommand = async (command) => {
      const cmd = command.replace(/^sudo\s+/, "");
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const exec = promisify(execFile);
      try {
        const { stdout, stderr } = await exec("/bin/sh", ["-c", cmd]);
        return { stdout, stderr, exitCode: 0 };
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string; code?: number };
        return { stdout: e.stdout ?? "", stderr: e.stderr ?? String(err), exitCode: e.code ?? 1 };
      }
    };

    const writer = makeClaudeTokenWriter(deps(run));
    const result = await writer("sk-ant-oat01-secret42");
    expect(result).toEqual({ persisted: true });

    const written = await readFile(envFile, "utf-8");
    expect(written.trim()).toBe("CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-secret42");
  });

  it("reports persisted:false when the helper exits non-zero", async () => {
    const run: RunCommand = async () => ({ stdout: "", stderr: "boom", exitCode: 3 });
    const writer = makeClaudeTokenWriter(deps(run));
    expect(await writer("sk-ant-oat01-abc")).toEqual({ persisted: false });
  });

  it("refuses to shell an invalid token", async () => {
    const run = vi.fn();
    const writer = makeClaudeTokenWriter(deps(run as unknown as RunCommand));
    expect(await writer("bad-token")).toEqual({ persisted: false });
    expect(run).not.toHaveBeenCalled();
  });
});
