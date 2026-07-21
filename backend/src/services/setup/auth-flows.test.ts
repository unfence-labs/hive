import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isValidClaudeToken,
  loadSetupSecrets,
  makeClaudeTokenWriter,
} from "./auth-flows.js";

describe("isValidClaudeToken", () => {
  it("accepts the OAuth token alphabet", () => {
    expect(isValidClaudeToken("sk-ant-oat01-abc123")).toBe(true);
    expect(isValidClaudeToken("sk-ant-oat01-Ab_9-Xy")).toBe(true);
  });

  it("rejects empty, malformed, or injectable values", () => {
    for (const token of [
      "",
      "nope",
      "sk-ant-oat01-",
      "sk-ant-oat01-abc def",
      "sk-ant-oat01-abc\nNODE_OPTIONS=x",
      "sk-ant-oat01-a;b",
    ]) {
      expect(isValidClaudeToken(token)).toBe(false);
    }
  });
});

describe("setup secrets", () => {
  let dataDir: string;
  let previousToken: string | undefined;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "hive-setup-secrets-"));
    previousToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  });

  afterEach(async () => {
    if (previousToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = previousToken;
    await rm(dataDir, { recursive: true, force: true });
  });

  it("atomically writes structured JSON with mode 0600 and adopts the token", async () => {
    const token = "sk-ant-oat01-secret42";
    await makeClaudeTokenWriter(dataDir)(token);

    const path = join(dataDir, "setup-secrets.json");
    expect(JSON.parse(await readFile(path, "utf-8"))).toEqual({
      claudeCodeOAuthToken: token,
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toBe(token);
    expect((await readdir(dataDir)).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
  });

  it("rejects an invalid token without creating a file", async () => {
    await expect(makeClaudeTokenWriter(dataDir)("bad-token")).rejects.toThrow(
      "Invalid Claude token",
    );
    expect(await readdir(dataDir)).toEqual([]);
  });

  it("loads a persisted token into the process", async () => {
    const token = "sk-ant-oat01-persisted";
    await makeClaudeTokenWriter(dataDir)(token);
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;

    await expect(loadSetupSecrets(dataDir)).resolves.toBe(true);
    expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toBe(token);
  });

  it("keeps an explicitly configured environment token", async () => {
    await makeClaudeTokenWriter(dataDir)("sk-ant-oat01-persisted");
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "sk-ant-oat01-explicit";

    await expect(loadSetupSecrets(dataDir)).resolves.toBe(false);
    expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toBe("sk-ant-oat01-explicit");
  });

  it("returns false when no secret exists", async () => {
    await expect(loadSetupSecrets(dataDir)).resolves.toBe(false);
  });

  it("ignores corrupt or invalid persisted secrets instead of failing startup", async () => {
    const path = join(dataDir, "setup-secrets.json");
    await writeFile(path, "not-json", "utf-8");
    await expect(loadSetupSecrets(dataDir)).resolves.toBe(false);
    expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();

    await writeFile(path, JSON.stringify({ claudeCodeOAuthToken: "bad" }), "utf-8");
    await expect(loadSetupSecrets(dataDir)).resolves.toBe(false);
    expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });
});
