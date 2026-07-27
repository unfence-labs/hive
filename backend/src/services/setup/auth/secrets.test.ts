import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getClaudeOAuthToken,
  isValidClaudeToken,
  loadSetupSecrets,
  makeClaudeTokenWriter,
} from "./secrets.js";

const TOKEN = "sk-ant-oat01-AbC123_dEf456-GhI789jklMNO";

let dataDir: string;
let secretsPath: string;
let originalEnv: string | undefined;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "hive-secrets-"));
  secretsPath = join(dataDir, "setup-secrets.json");
  originalEnv = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
  if (originalEnv === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  else process.env.CLAUDE_CODE_OAUTH_TOKEN = originalEnv;
});

describe("token validation", () => {
  it("accepts a well-formed token", () => {
    expect(isValidClaudeToken(TOKEN)).toBe(true);
  });

  it.each([
    ["an API key rather than an OAuth token", "sk-ant-api03-abcdefghijklmnop"],
    ["a truncated token", "sk-ant-oat01-short"],
    ["a token with something appended", `${TOKEN} and more`],
    ["a token with a line of output around it", `token: ${TOKEN}`],
    ["an empty string", ""],
    ["a non-string", 42],
  ])("rejects %s", (_label, value) => {
    expect(isValidClaudeToken(value)).toBe(false);
  });
});

describe("storing the token", () => {
  it("writes it readable only by the account that owns it", async () => {
    await makeClaudeTokenWriter(dataDir)(TOKEN);

    expect(JSON.parse(await readFile(secretsPath, "utf-8"))).toEqual({
      claudeCodeOAuthToken: TOKEN,
    });
    expect((await stat(secretsPath)).mode & 0o777).toBe(0o600);
    expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toBe(TOKEN);
    expect(getClaudeOAuthToken()).toBe(TOKEN);
  });

  it("leaves no temporary file behind", async () => {
    await makeClaudeTokenWriter(dataDir)(TOKEN);
    expect(await readdir(dataDir)).toEqual(["setup-secrets.json"]);
  });

  it("replaces an existing token without a window where it is world-readable", async () => {
    const write = makeClaudeTokenWriter(dataDir);
    await write(TOKEN);
    const replacement = `${TOKEN}XYZ`;

    await write(replacement);

    expect(JSON.parse(await readFile(secretsPath, "utf-8")).claudeCodeOAuthToken).toBe(
      replacement,
    );
    expect((await stat(secretsPath)).mode & 0o777).toBe(0o600);
  });

  it("refuses a value that is not a token, and writes nothing", async () => {
    await expect(makeClaudeTokenWriter(dataDir)("not-a-token")).rejects.toThrow(
      /not a claude authentication token/i,
    );
    await expect(stat(secretsPath)).rejects.toThrow();
    expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });
});

describe("loading the token at boot", () => {
  it("reads a stored token back into the process", async () => {
    await makeClaudeTokenWriter(dataDir)(TOKEN);
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;

    await expect(loadSetupSecrets(dataDir)).resolves.toBe(true);
    expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toBe(TOKEN);
  });

  it("leaves an explicitly configured token alone", async () => {
    await makeClaudeTokenWriter(dataDir)(TOKEN);
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "sk-ant-oat01-fromTheEnvironment-1234";

    await expect(loadSetupSecrets(dataDir)).resolves.toBe(false);
    expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toContain("fromTheEnvironment");
  });

  it("starts without a token rather than not starting", async () => {
    await expect(loadSetupSecrets(dataDir)).resolves.toBe(false);
    expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });

  it.each([
    ["unreadable JSON", "{not json"],
    ["a file with no token in it", '{"somethingElse":true}'],
    ["a token that no longer validates", '{"claudeCodeOAuthToken":"nope"}'],
  ])("ignores %s instead of refusing to boot", async (_label, contents) => {
    await writeFile(secretsPath, contents, { mode: 0o600 });

    await expect(loadSetupSecrets(dataDir)).resolves.toBe(false);
    expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });
});
