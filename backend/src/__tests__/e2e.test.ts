import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import WebSocket from "ws";
import { rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createTempDir, createFixtureRepo } from "../utils/test-helpers.js";
import { projectRoutes } from "../api/projects.js";
import { workspaceRoutes } from "../api/workspaces.js";
import { agentRoutes } from "../api/agents.js";
import { streamRoutes } from "../ws/stream.js";
import { _clearActiveAgents, getActiveProcess } from "../agents/agent-manager.js";
import type { WsMessage } from "../types.js";

const MOCK_AGENT = {
  command: "bash",
  args: ["-c", 'sleep 0.3; echo "Analyzing code..."; sleep 0.1; echo "Done."'],
};

let tempDir: string;
let dataDir: string;
let fixtureRepoUrl: string;
let app: ReturnType<typeof Fastify>;
let address: string;

beforeEach(async () => {
  tempDir = await createTempDir("hive-e2e-test-");
  dataDir = join(tempDir, "data");
  const fixtureDir = join(tempDir, "fixtures");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dataDir, { recursive: true });
  await mkdir(fixtureDir, { recursive: true });
  fixtureRepoUrl = await createFixtureRepo(fixtureDir);

  app = Fastify();
  await app.register(websocket);
  await app.register((instance: FastifyInstance) => projectRoutes(instance, dataDir));
  await app.register((instance: FastifyInstance) => workspaceRoutes(instance, dataDir));
  await app.register((instance: FastifyInstance) =>
    agentRoutes(instance, { dataDir, launchOptions: MOCK_AGENT }),
  );
  await app.register(streamRoutes);

  app.get("/health", async () => ({ status: "ok" }));
  address = await app.listen({ port: 0, host: "127.0.0.1" });
});

afterEach(async () => {
  _clearActiveAgents();
  await new Promise((r) => setTimeout(r, 100));
  await app.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("E2E: full lifecycle", () => {
  it("creates project → workspace → agent → stream → diff → merge", async () => {
    // 1. Health check
    const healthRes = await app.inject({ method: "GET", url: "/health" });
    expect(healthRes.statusCode).toBe(200);
    expect(healthRes.json().status).toBe("ok");

    // 2. Create project
    const projRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { url: fixtureRepoUrl },
    });
    expect(projRes.statusCode).toBe(201);
    const project = projRes.json();
    expect(project.id).toMatch(/^proj-/);

    // 3. List projects
    const listRes = await app.inject({ method: "GET", url: "/api/projects" });
    expect(listRes.json()).toHaveLength(1);

    // 4. Create workspace
    const wsRes = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/workspaces`,
    });
    expect(wsRes.statusCode).toBe(201);
    const workspace = wsRes.json();
    expect(workspace.status).toBe("idle");
    expect(workspace.branch).toMatch(/^workspace\//);

    // 5. Launch agent
    const agentRes = await app.inject({
      method: "POST",
      url: `/api/workspaces/${workspace.id}/agents`,
      payload: { prompt: "refactor auth module" },
    });
    expect(agentRes.statusCode).toBe(201);
    const agent = agentRes.json();
    expect(agent.status).toBe("running");

    // 6. Stream agent output via WebSocket
    const wsUrl = address.replace("http://", "ws://");
    const wsClient = new WebSocket(`${wsUrl}/ws/agents/${agent.id}/stream`);
    const messages: WsMessage[] = [];

    await new Promise<void>((resolve) => {
      wsClient.on("open", resolve);
    });

    await new Promise<void>((resolve) => {
      wsClient.on("message", (data) => {
        messages.push(JSON.parse(data.toString()));
      });
      wsClient.on("close", resolve);
    });

    const stdoutMsgs = messages.filter((m) => m.type === "stdout");
    expect(stdoutMsgs.length).toBeGreaterThan(0);
    const output = stdoutMsgs.map((m) => m.data).join("");
    expect(output).toContain("Analyzing code");

    const exitMsg = messages.find((m) => m.type === "exit");
    expect(exitMsg).toBeDefined();
    expect(exitMsg!.code).toBe(0);

    // 7. Wait for state to update
    await new Promise((r) => setTimeout(r, 200));

    // 8. Check agent is done and workspace is idle
    const agentDetailRes = await app.inject({
      method: "GET",
      url: `/api/agents/${agent.id}`,
    });
    expect(agentDetailRes.statusCode).toBe(200);
    const agentDetail = agentDetailRes.json();
    expect(agentDetail.status).toBe("done");
    expect(agentDetail.exitCode).toBe(0);

    // 9. Check workspace is back to idle
    const wsDetailRes = await app.inject({
      method: "GET",
      url: `/api/workspaces/${workspace.id}`,
    });
    expect(wsDetailRes.json().status).toBe("idle");

    // 10. Get diff (empty since our mock agent doesn't actually modify files)
    const diffRes = await app.inject({
      method: "GET",
      url: `/api/workspaces/${workspace.id}/diff`,
    });
    expect(diffRes.statusCode).toBe(200);

    // 11. Agent history
    const historyRes = await app.inject({
      method: "GET",
      url: `/api/workspaces/${workspace.id}/agents`,
    });
    expect(historyRes.json()).toHaveLength(1);
    expect(historyRes.json()[0].prompt).toBe("refactor auth module");

    // 12. Now simulate making changes for merge
    // (In real usage, the agent would have made git commits. We'll do it manually.)
    const { writeFile } = await import("node:fs/promises");
    const { git } = await import("../utils/git.js");
    const wsPath = join(dataDir, project.id, "workspaces", workspace.name);
    await writeFile(join(wsPath, "refactored.ts"), "export const auth = true;\n");
    await git(["add", "."], wsPath);
    await git(["config", "user.email", "test@hive.dev"], wsPath);
    await git(["config", "user.name", "Test Agent"], wsPath);
    await git(["commit", "-m", "refactor auth module"], wsPath);

    // 13. Get diff (should now show changes)
    const diffRes2 = await app.inject({
      method: "GET",
      url: `/api/workspaces/${workspace.id}/diff`,
    });
    expect(diffRes2.json().diff).toContain("refactored.ts");

    // 14. Merge workspace
    const mergeRes = await app.inject({
      method: "POST",
      url: `/api/workspaces/${workspace.id}/merge`,
    });
    expect(mergeRes.statusCode).toBe(200);
    expect(mergeRes.json().status).toBe("merged");

    // 15. Workspace should be gone
    const wsGoneRes = await app.inject({
      method: "GET",
      url: `/api/workspaces/${workspace.id}`,
    });
    expect(wsGoneRes.statusCode).toBe(404);

    // 16. Verify changes are on main (create new workspace to check)
    const newWsRes = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/workspaces`,
    });
    const newWs = newWsRes.json();
    const newWsPath = join(dataDir, project.id, "workspaces", newWs.name);
    expect(existsSync(join(newWsPath, "refactored.ts"))).toBe(true);
    const content = await readFile(join(newWsPath, "refactored.ts"), "utf-8");
    expect(content).toContain("export const auth = true");

    // 17. Cleanup: delete project
    const delRes = await app.inject({
      method: "DELETE",
      url: `/api/projects/${project.id}`,
    });
    expect(delRes.statusCode).toBe(204);

    // 18. Verify project is gone
    const projGoneRes = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}`,
    });
    expect(projGoneRes.statusCode).toBe(404);
  }, 15000);

  it("returns 409 when trying to launch agent on busy workspace", async () => {
    // Setup
    const projRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { url: fixtureRepoUrl },
    });
    const project = projRes.json();

    const wsRes = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/workspaces`,
    });
    const workspace = wsRes.json();

    // Use a slow app for this test to keep agent running
    const slowApp = Fastify();
    await slowApp.register(websocket);
    await slowApp.register((instance: FastifyInstance) => projectRoutes(instance, dataDir));
    await slowApp.register((instance: FastifyInstance) => workspaceRoutes(instance, dataDir));
    await slowApp.register((instance: FastifyInstance) =>
      agentRoutes(instance, {
        dataDir,
        launchOptions: { command: "sleep", args: ["30"] },
      }),
    );
    await slowApp.ready();

    // Launch agent
    const agent1Res = await slowApp.inject({
      method: "POST",
      url: `/api/workspaces/${workspace.id}/agents`,
      payload: { prompt: "long running task" },
    });
    expect(agent1Res.statusCode).toBe(201);

    // Try to launch another — should get 409
    const agent2Res = await slowApp.inject({
      method: "POST",
      url: `/api/workspaces/${workspace.id}/agents`,
      payload: { prompt: "another task" },
    });
    expect(agent2Res.statusCode).toBe(409);

    _clearActiveAgents();
    await slowApp.close();
  });
});
