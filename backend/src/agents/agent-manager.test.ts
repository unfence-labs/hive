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
  launchConversation,
  getConversation,
  sendMessage,
  stopConversation,
  endConversation,
  _clearActiveConversations,
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
  _clearActiveConversations();
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

// NDJSON output that mimics Claude CLI stream-json format
const NDJSON_OUTPUT = [
  '{"type":"stream_event","event":{"type":"message_start","message":{"id":"msg-1","role":"assistant"}}}',
  '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}}',
  '{"type":"stream_event","event":{"type":"message_stop"}}',
  '{"type":"result","result":{"type":"success"},"session_id":"test-sess","cost_usd":0.01}',
].join("\n") + "\n";

const CONV_CMD = { command: "bash" };

function ndjsonEchoArgs(): string[] {
  // Use printf to output NDJSON lines — avoids issues with echo escaping
  return ["-c", `printf '%s\\n' '${NDJSON_OUTPUT.split("\n").filter(Boolean).join("' '")}'`];
}

describe("launchConversation", () => {
  it("creates a conversation and sets workspace to in_session", async () => {
    const conv = await launchConversation(wsId, dataDir, CONV_CMD);

    expect(conv.sessionId).toBeTruthy();
    expect(conv.status).toBe("idle");
    expect(conv.messages).toEqual([]);

    const state = await loadProject(projectId, dataDir);
    const ws = state!.workspaces.find((w) => w.id === wsId);
    expect(ws!.status).toBe("in_session");
  });

  it("rejects launching on a busy workspace", async () => {
    await launchConversation(wsId, dataDir, CONV_CMD);
    await expect(launchConversation(wsId, dataDir, CONV_CMD)).rejects.toThrow("busy");
  });

  it("rejects agent launch when conversation is active", async () => {
    await launchConversation(wsId, dataDir, CONV_CMD);
    await expect(launchAgent(wsId, "test", dataDir, MOCK_CMD)).rejects.toThrow("busy");
  });

  it("uses provided sessionId", async () => {
    const conv = await launchConversation(wsId, dataDir, CONV_CMD, "my-session-id");
    expect(conv.sessionId).toBe("my-session-id");
  });
});

describe("getConversation", () => {
  it("returns session for active conversation", async () => {
    await launchConversation(wsId, dataDir, CONV_CMD);
    const session = getConversation(wsId);
    expect(session).toBeDefined();
  });

  it("returns undefined for workspace without conversation", () => {
    const session = getConversation(wsId);
    expect(session).toBeUndefined();
  });
});

describe("sendMessage", () => {
  it("forwards message to conversation session", async () => {
    await launchConversation(wsId, dataDir, CONV_CMD);

    // Use a command that echoes NDJSON
    const session = getConversation(wsId)!;

    // sendMessage should not throw
    const returned = sendMessage(wsId, "Hello");
    expect(returned).toBe(session);
    expect(session.status).toBe("streaming");
  });

  it("throws when no conversation exists", () => {
    expect(() => sendMessage(wsId, "Hello")).toThrow("No conversation session");
  });
});

describe("stopConversation", () => {
  it("stops streaming but keeps session alive", async () => {
    await launchConversation(wsId, dataDir, CONV_CMD);
    sendMessage(wsId, "Hello");

    stopConversation(wsId);

    // Session should still exist
    const session = getConversation(wsId);
    expect(session).toBeDefined();
  });

  it("throws when no conversation exists", () => {
    expect(() => stopConversation(wsId)).toThrow("No conversation session");
  });
});

describe("endConversation", () => {
  it("terminates session and sets workspace back to idle", async () => {
    await launchConversation(wsId, dataDir, CONV_CMD);
    await endConversation(wsId, dataDir);

    expect(getConversation(wsId)).toBeUndefined();

    const state = await loadProject(projectId, dataDir);
    const ws = state!.workspaces.find((w) => w.id === wsId);
    expect(ws!.status).toBe("idle");
  });

  it("allows launching a new agent after ending conversation", async () => {
    await launchConversation(wsId, dataDir, CONV_CMD);
    await endConversation(wsId, dataDir);

    const agent = await launchAgent(wsId, "after conv", dataDir, MOCK_CMD);
    expect(agent.status).toBe("running");
    await waitForAgent(agent.id);
  });

  it("throws when no conversation exists", async () => {
    await expect(endConversation(wsId, dataDir)).rejects.toThrow("No conversation session");
  });
});
