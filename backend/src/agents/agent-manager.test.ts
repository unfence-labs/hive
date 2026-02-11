import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir, createFixtureRepo } from "../utils/test-helpers.js";
import { createProject } from "../projects/project-manager.js";
import { createWorkspace } from "../workspaces/workspace-manager.js";
import {
  launchAgent,
  getAgent,
  listAgents,
  getActiveProcess,
  _clearActiveAgents,
} from "./agent-manager.js";
import { loadProject } from "../state/state.js";

const MOCK_CMD = { command: "echo", args: ["mock output"] };
const SLOW_CMD = { command: "sleep", args: ["30"] };

let tempDir: string;
let dataDir: string;
let projectId: string;
let wsId: string;

function waitForAgent(agentId: string): Promise<void> {
  return new Promise((resolve) => {
    const proc = getActiveProcess(agentId);
    if (!proc || proc.status !== "running") return resolve();
    proc.on("exit", () => resolve());
    proc.on("error", () => resolve());
  });
}

beforeEach(async () => {
  tempDir = await createTempDir("hive-agent-mgr-test-");
  dataDir = join(tempDir, "data");
  const fixtureDir = join(tempDir, "fixtures");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dataDir, { recursive: true });
  await mkdir(fixtureDir, { recursive: true });
  const fixtureRepoUrl = await createFixtureRepo(fixtureDir);
  const project = await createProject(fixtureRepoUrl, dataDir);
  projectId = project.id;
  const ws = await createWorkspace(projectId, dataDir);
  wsId = ws.id;
});

afterEach(async () => {
  _clearActiveAgents();
  // Small delay to let any pending state writes settle
  await new Promise((r) => setTimeout(r, 50));
  await rm(tempDir, { recursive: true, force: true });
});

describe("launchAgent", () => {
  it("launches an agent and sets workspace to running", async () => {
    const agent = await launchAgent(wsId, "test prompt", dataDir, MOCK_CMD);

    expect(agent.id).toMatch(/^agent-/);
    expect(agent.status).toBe("running");
    expect(agent.prompt).toBe("test prompt");

    const state = await loadProject(projectId, dataDir);
    const ws = state!.workspaces.find((w) => w.id === wsId);
    expect(ws!.status).toBe("running");
    expect(ws!.agents).toHaveLength(1);

    await waitForAgent(agent.id);
  });

  it("rejects launching on a busy workspace", async () => {
    const agent = await launchAgent(wsId, "first", dataDir, SLOW_CMD);

    await expect(launchAgent(wsId, "second", dataDir, MOCK_CMD)).rejects.toThrow("busy");

    const proc = getActiveProcess(agent.id);
    proc?.stop();
    await waitForAgent(agent.id);
  });
});

describe("getAgent", () => {
  it("returns agent by ID", async () => {
    const agent = await launchAgent(wsId, "find me", dataDir, MOCK_CMD);
    await waitForAgent(agent.id);

    const found = await getAgent(agent.id, dataDir);
    expect(found).not.toBeNull();
    expect(found!.prompt).toBe("find me");
  });

  it("returns null for non-existent agent", async () => {
    const found = await getAgent("nonexistent", dataDir);
    expect(found).toBeNull();
  });
});

describe("listAgents", () => {
  it("returns agent history for workspace", async () => {
    const agent = await launchAgent(wsId, "history test", dataDir, MOCK_CMD);
    await waitForAgent(agent.id);

    const agents = await listAgents(wsId, dataDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].prompt).toBe("history test");
  });

  it("throws for non-existent workspace", async () => {
    await expect(listAgents("nonexistent", dataDir)).rejects.toThrow("not found");
  });
});

describe("agent completion", () => {
  it("sets workspace back to idle when agent finishes", async () => {
    const agent = await launchAgent(wsId, "will finish", dataDir, MOCK_CMD);
    await waitForAgent(agent.id);
    await new Promise((r) => setTimeout(r, 100));

    const state = await loadProject(projectId, dataDir);
    const ws = state!.workspaces.find((w) => w.id === wsId);
    expect(ws!.status).toBe("idle");
  });

  it("records exit code and finish time", async () => {
    const agent = await launchAgent(wsId, "track exit", dataDir, MOCK_CMD);
    await waitForAgent(agent.id);
    await new Promise((r) => setTimeout(r, 100));

    const found = await getAgent(agent.id, dataDir);
    expect(found).not.toBeNull();
    expect(found!.finishedAt).toBeTruthy();
    expect(found!.exitCode).toBe(0);
    expect(found!.status).toBe("done");
  });

  it("can launch a new agent after previous one finishes", async () => {
    const agent1 = await launchAgent(wsId, "first", dataDir, MOCK_CMD);
    await waitForAgent(agent1.id);
    await new Promise((r) => setTimeout(r, 100));

    const agent2 = await launchAgent(wsId, "second", dataDir, MOCK_CMD);
    await waitForAgent(agent2.id);
    await new Promise((r) => setTimeout(r, 100));

    const agents = await listAgents(wsId, dataDir);
    expect(agents).toHaveLength(2);
    expect(agents[0].prompt).toBe("first");
    expect(agents[1].prompt).toBe("second");
  });
});
