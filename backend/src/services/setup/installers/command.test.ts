import { describe, it, expect } from "vitest";
import { realRunCommand, shellQuote } from "./command.js";

describe("realRunCommand", () => {
  it("pipes stdin to the child and captures its output", async () => {
    const result = await realRunCommand("cat", { stdin: "hello-stdin" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello-stdin");
  });

  it("keeps the no-stdin path working and reports the exit code", async () => {
    const ok = await realRunCommand("printf ok");
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout).toBe("ok");

    const fail = await realRunCommand("exit 3");
    expect(fail.exitCode).toBe(3);
  });

  it("does not expose stdin content on the command line", async () => {
    // The command is fixed; the secret only flows through stdin.
    const result = await realRunCommand('grep -q secret && echo matched', {
      stdin: "a secret line\n",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("matched");
  });
});

describe("shellQuote", () => {
  it("passes safe tokens through and quotes the rest", () => {
    expect(shellQuote("plain-token_1.2")).toBe("plain-token_1.2");
    expect(shellQuote("has space")).toBe("'has space'");
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });
});
