import { describe, expect, it } from "vitest";
import { TOOL_OUTPUT_EXCERPT_MAX } from "@hive/shared/setup-types";
import {
  classifyFailure,
  outputExcerpt,
  runCommand,
  type CommandResult,
} from "./command.js";

function result(overrides: Partial<CommandResult> = {}): CommandResult {
  return { stdout: "", stderr: "", exitCode: 1, timedOut: false, ...overrides };
}

describe("classifyFailure", () => {
  it("reads a name-resolution failure as a network problem", () => {
    expect(
      classifyFailure(result({ stderr: "npm error code ENOTFOUND\nnpm error syscall getaddrinfo" })),
    ).toBe("network");
  });

  it.each([
    "getaddrinfo EAI_AGAIN registry.npmjs.org",
    "connect ECONNREFUSED 127.0.0.1:443",
    "network is unreachable",
    "Temporary failure in name resolution",
    "request to https://registry.npmjs.org/foo failed, reason: socket hang up",
  ])("reads %s as a network problem", (stderr) => {
    expect(classifyFailure(result({ stderr }))).toBe("network");
  });

  it("reads a non-zero exit with real output as a command failure", () => {
    expect(
      classifyFailure(result({ exitCode: 1, stderr: "npm error EACCES: permission denied" })),
    ).toBe("command_failed");
  });

  it("reads a killed command as a timeout even when the output looks network-ish", () => {
    expect(classifyFailure(result({ timedOut: true, stderr: "ETIMEDOUT" }))).toBe("timeout");
  });
});

describe("outputExcerpt", () => {
  it("returns nothing when the command said nothing", () => {
    expect(outputExcerpt(result())).toBeUndefined();
  });

  it("returns short output untouched", () => {
    expect(outputExcerpt(result({ stderr: "npm error EACCES" }))).toBe("npm error EACCES");
  });

  it("bounds long output and keeps the tail, where the error is", () => {
    const excerpt = outputExcerpt(
      result({ stdout: `banner ${"x".repeat(5_000)}`, stderr: "npm error the real cause" }),
    );
    expect(excerpt).toBeDefined();
    expect(excerpt!.length).toBe(TOOL_OUTPUT_EXCERPT_MAX + 1);
    expect(excerpt!.startsWith("…")).toBe(true);
    expect(excerpt!.endsWith("npm error the real cause")).toBe(true);
  });

  it("keeps only the last lines of a chatty command", () => {
    const excerpt = outputExcerpt(
      result({ stdout: "banner\n".repeat(50), stderr: "npm error the real cause" }),
    );
    expect(excerpt).toBe([...Array<string>(11).fill("banner"), "npm error the real cause"].join("\n"));
  });
});

describe("runCommand", () => {
  it("reports a successful command", async () => {
    const res = await runCommand(process.execPath, ["-e", "process.stdout.write('hi')"]);
    expect(res).toMatchObject({ stdout: "hi", exitCode: 0, timedOut: false });
  });

  it("captures the exit code and stderr of a failing command", async () => {
    const res = await runCommand(process.execPath, [
      "-e",
      "process.stderr.write('nope'); process.exit(3)",
    ]);
    expect(res.exitCode).toBe(3);
    expect(res.stderr).toContain("nope");
    expect(classifyFailure(res)).toBe("command_failed");
  });

  it("reports a missing executable as exit 127 rather than throwing", async () => {
    const res = await runCommand("hive-definitely-not-a-real-binary", ["--version"]);
    expect(res.exitCode).toBe(127);
  });

  it("kills a command that outlives its timeout and flags it", async () => {
    const res = await runCommand(process.execPath, ["-e", "setTimeout(() => {}, 10_000)"], {
      timeoutMs: 150,
    });
    expect(res.timedOut).toBe(true);
    expect(classifyFailure(res)).toBe("timeout");
  });
});
