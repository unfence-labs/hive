import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "../utils/test-helpers.js";
import { loadAgents, saveAgents } from "./agents.js";
import type { Agent } from "../types.js";

let dataDir: string;

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-test1",
    name: "Code Auditor",
    description: "Reviews code for issues",
    systemPrompt: "You are a meticulous code reviewer.",
    modelId: "claude:sonnet-4-6",
    thinkingLevel: "high",
    readOnly: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(async () => {
  const tmp = await createTempDir();
  dataDir = join(tmp, "data");
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
});

describe("agents persistence", () => {
  it("returns empty array when no file exists", async () => {
    const result = await loadAgents(dataDir);
    expect(result).toEqual([]);
  });

  it("saves and loads agents", async () => {
    const agents = [
      makeAgent(),
      makeAgent({ id: "agent-test2", name: "Dependency Checker", readOnly: false }),
    ];
    await saveAgents(agents, dataDir);
    const loaded = await loadAgents(dataDir);
    expect(loaded).toHaveLength(2);
    expect(loaded[0]).toEqual(agents[0]);
    expect(loaded[1].readOnly).toBe(false);
  });

  it("overwrites on save", async () => {
    await saveAgents([makeAgent()], dataDir);
    await saveAgents([makeAgent({ name: "Updated" })], dataDir);
    const loaded = await loadAgents(dataDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("Updated");
  });

  it("normalizes old agents without a thinkingLevel", async () => {
    const { thinkingLevel: _thinkingLevel, ...legacy } = makeAgent();
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, "agents.json"), JSON.stringify([legacy]), "utf-8");

    const loaded = await loadAgents(dataDir);
    expect(loaded[0].thinkingLevel).toBe("high");
  });

  it("normalizes unsupported thinkingLevel values", async () => {
    await saveAgents([makeAgent({ modelId: "codex:gpt-5.5", thinkingLevel: "max" })], dataDir);

    const loaded = await loadAgents(dataDir);
    expect(loaded[0].thinkingLevel).toBe("high");
  });

  it("clears a stale thinkingLevel for models with no thinking-level control", async () => {
    await saveAgents([makeAgent({ modelId: "kimi:k3", thinkingLevel: "high" })], dataDir);

    const loaded = await loadAgents(dataDir);
    expect(loaded[0].thinkingLevel).toBeUndefined();
  });
});
