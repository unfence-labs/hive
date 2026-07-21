import { describe, expect, it } from "vitest";
import { realRunCommand } from "./command.js";

describe("realRunCommand", () => {
  it("captures output from a successful command", async () => {
    const result = await realRunCommand("printf ok");
    expect(result).toEqual({ stdout: "ok", stderr: "", exitCode: 0 });
  });

  it("returns a non-zero command exit without rejecting", async () => {
    const result = await realRunCommand("printf failure >&2; exit 3");
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("failure");
  });

  it("passes explicit environment variables", async () => {
    const result = await realRunCommand('printf "$HIVE_COMMAND_TEST"', {
      env: { HIVE_COMMAND_TEST: "present" },
    });
    expect(result.stdout).toBe("present");
  });
});
