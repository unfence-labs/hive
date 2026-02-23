import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildWorkspaceEnv } from "./env.js";

describe("buildWorkspaceEnv()", () => {
  const savedEnv: Record<string, string | undefined> = {};
  const testKeys = [
    "NODE_ENV",
    "PORT",
    "HOST",
    "DATA_DIR",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHAT_ID",
    "GITHUB_CLIENT_ID",
    "MAX_THINKING_TOKENS",
    "HIVE_AUTH_TOKEN",
    "HIVE_RATE_LIMIT_MAX",
    "HIVE_CUSTOM_FUTURE_VAR",
    "SAFE_VAR",
  ];

  beforeEach(() => {
    for (const key of testKeys) {
      savedEnv[key] = process.env[key];
    }
    process.env.NODE_ENV = "production";
    process.env.PORT = "9420";
    process.env.HOST = "0.0.0.0";
    process.env.DATA_DIR = "~/.hive";
    process.env.TELEGRAM_BOT_TOKEN = "secret-bot-token";
    process.env.TELEGRAM_CHAT_ID = "12345";
    process.env.GITHUB_CLIENT_ID = "gh-client-id";
    process.env.MAX_THINKING_TOKENS = "31999";
    process.env.HIVE_AUTH_TOKEN = "secret-auth";
    process.env.HIVE_RATE_LIMIT_MAX = "100";
    process.env.HIVE_CUSTOM_FUTURE_VAR = "whatever";
    process.env.SAFE_VAR = "keep-me";
  });

  afterEach(() => {
    for (const key of testKeys) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it("strips exact backend vars", () => {
    const env = buildWorkspaceEnv();
    expect(env.NODE_ENV).toBeUndefined();
    expect(env.PORT).toBeUndefined();
    expect(env.HOST).toBeUndefined();
    expect(env.DATA_DIR).toBeUndefined();
    expect(env.TELEGRAM_BOT_TOKEN).toBeUndefined();
    expect(env.TELEGRAM_CHAT_ID).toBeUndefined();
    expect(env.GITHUB_CLIENT_ID).toBeUndefined();
    expect(env.MAX_THINKING_TOKENS).toBeUndefined();
  });

  it("strips HIVE_ prefixed vars", () => {
    const env = buildWorkspaceEnv();
    expect(env.HIVE_AUTH_TOKEN).toBeUndefined();
    expect(env.HIVE_RATE_LIMIT_MAX).toBeUndefined();
    expect(env.HIVE_CUSTOM_FUTURE_VAR).toBeUndefined();
  });

  it("preserves other vars", () => {
    const env = buildWorkspaceEnv();
    expect(env.SAFE_VAR).toBe("keep-me");
    expect(env.PATH).toBe(process.env.PATH);
  });

  it("merges extra overrides", () => {
    const env = buildWorkspaceEnv({ TERM: "xterm-256color", MY_VAR: "hello" });
    expect(env.TERM).toBe("xterm-256color");
    expect(env.MY_VAR).toBe("hello");
    expect(env.SAFE_VAR).toBe("keep-me");
  });

  it("allows extra to re-inject a stripped var", () => {
    const env = buildWorkspaceEnv({ NODE_ENV: "test" });
    expect(env.NODE_ENV).toBe("test");
  });

  it("returns a new object (does not mutate process.env)", () => {
    const env = buildWorkspaceEnv({ FOO: "bar" });
    expect(process.env.FOO).toBeUndefined();
    expect(env).not.toBe(process.env);
  });
});
