import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "../utils/test-helpers.js";
import { AgentProcess } from "./agent-process.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await createTempDir("hive-agent-proc-test-");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("AgentProcess", () => {
  it("captures output and emits data events", async () => {
    const logFile = join(tempDir, "logs", "test.log");
    const agent = new AgentProcess({
      cwd: tempDir,
      prompt: "test",
      logFile,
      command: "echo",
      args: ["hello world"],
    });

    const chunks: string[] = [];
    agent.on("data", (chunk) => chunks.push(chunk));

    const exitPromise = new Promise<number>((resolve) => {
      agent.on("exit", resolve);
    });

    await agent.start();
    const code = await exitPromise;

    expect(code).toBe(0);
    expect(agent.status).toBe("done");
    expect(agent.exitCode).toBe(0);
    expect(chunks.join("")).toContain("hello world");
  });

  it("writes output to log file", async () => {
    const logFile = join(tempDir, "logs", "log-test.log");
    const agent = new AgentProcess({
      cwd: tempDir,
      prompt: "test",
      logFile,
      command: "echo",
      args: ["logged output"],
    });

    const exitPromise = new Promise<number>((resolve) => {
      agent.on("exit", resolve);
    });

    await agent.start();
    await exitPromise;

    const content = await readFile(logFile, "utf-8");
    expect(content).toContain("logged output");
  });

  it("reports error status for non-zero exit code", async () => {
    const logFile = join(tempDir, "logs", "error-test.log");
    const agent = new AgentProcess({
      cwd: tempDir,
      prompt: "test",
      logFile,
      command: "bash",
      args: ["-c", "exit 42"],
    });

    const exitPromise = new Promise<number>((resolve) => {
      agent.on("exit", resolve);
    });

    await agent.start();
    const code = await exitPromise;

    expect(code).toBe(42);
    expect(agent.status).toBe("error");
    expect(agent.exitCode).toBe(42);
  });

  it("can be stopped", async () => {
    const logFile = join(tempDir, "logs", "stop-test.log");
    const agent = new AgentProcess({
      cwd: tempDir,
      prompt: "test",
      logFile,
      command: "sleep",
      args: ["30"],
    });

    const exitPromise = new Promise<number>((resolve) => {
      agent.on("exit", resolve);
    });

    await agent.start();
    expect(agent.status).toBe("running");

    agent.stop();
    const code = await exitPromise;

    expect(agent.status).not.toBe("running");
    expect(typeof code).toBe("number");
  });

  it("handles non-existent command gracefully", async () => {
    const logFile = join(tempDir, "logs", "err-test.log");
    const agent = new AgentProcess({
      cwd: tempDir,
      prompt: "test",
      logFile,
      command: "nonexistent-command-xyz",
      args: [],
    });

    // node-pty may throw synchronously, emit error, or exit with non-zero code
    const settled = new Promise<void>((resolve) => {
      agent.on("error", () => resolve());
      agent.on("exit", () => resolve());
    });

    await agent.start();
    await settled;

    expect(agent.status).toBe("error");
  });

  it("rejects starting when already running", async () => {
    const logFile = join(tempDir, "logs", "double-start.log");
    const agent = new AgentProcess({
      cwd: tempDir,
      prompt: "test",
      logFile,
      command: "sleep",
      args: ["30"],
    });

    await agent.start();
    await expect(agent.start()).rejects.toThrow("Already running");
    agent.stop();
  });
});
