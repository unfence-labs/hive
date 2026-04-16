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
    "CLAUDECODE",
    "NODE_APP_INSTANCE",
    "GIT_EDITOR",
    "HIVE_AUTH_TOKEN",
    "HIVE_RATE_LIMIT_MAX",
    "HIVE_CUSTOM_FUTURE_VAR",
    "PM2_HOME",
    "PM2_USAGE",
    "pm_cwd",
    "pm_exec_path",
    "axm_monitor",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_ENABLE_TASKS",
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
    process.env.CLAUDECODE = "1";
    process.env.NODE_APP_INSTANCE = "0";
    process.env.GIT_EDITOR = "true";
    process.env.HIVE_AUTH_TOKEN = "secret-auth";
    process.env.HIVE_RATE_LIMIT_MAX = "100";
    process.env.HIVE_CUSTOM_FUTURE_VAR = "whatever";
    process.env.PM2_HOME = "/home/user/.pm2";
    process.env.PM2_USAGE = "CLI";
    process.env.pm_cwd = "/home/user/app";
    process.env.pm_exec_path = "/home/user/app/index.js";
    process.env.axm_monitor = "[object Object]";
    process.env.CLAUDE_CODE_ENTRYPOINT = "sdk-cli";
    process.env.CLAUDE_CODE_ENABLE_TASKS = "true";
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
    expect(env.DATA_DIR).toBeUndefined();
    expect(env.TELEGRAM_BOT_TOKEN).toBeUndefined();
    expect(env.TELEGRAM_CHAT_ID).toBeUndefined();
    expect(env.GITHUB_CLIENT_ID).toBeUndefined();
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.NODE_APP_INSTANCE).toBeUndefined();
    expect(env.GIT_EDITOR).toBeUndefined();
  });

  it("strips HIVE_ prefixed vars", () => {
    const env = buildWorkspaceEnv();
    expect(env.HIVE_AUTH_TOKEN).toBeUndefined();
    expect(env.HIVE_RATE_LIMIT_MAX).toBeUndefined();
    expect(env.HIVE_CUSTOM_FUTURE_VAR).toBeUndefined();
  });

  it("strips PM2_ and pm_ prefixed vars", () => {
    const env = buildWorkspaceEnv();
    expect(env.PM2_HOME).toBeUndefined();
    expect(env.PM2_USAGE).toBeUndefined();
    expect(env.pm_cwd).toBeUndefined();
    expect(env.pm_exec_path).toBeUndefined();
  });

  it("strips axm_ and CLAUDE_CODE_ prefixed vars", () => {
    const env = buildWorkspaceEnv();
    expect(env.axm_monitor).toBeUndefined();
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    expect(env.CLAUDE_CODE_ENABLE_TASKS).toBeUndefined();
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
