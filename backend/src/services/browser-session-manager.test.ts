import { describe, it, expect, beforeEach } from "vitest";
import { BrowserSessionManager } from "./browser-session-manager.js";

let manager: BrowserSessionManager;

beforeEach(() => {
  manager = new BrowserSessionManager();
});

describe("BrowserSessionManager", () => {
  it("allocates stable browser env for a session", async () => {
    const first = await manager.ensureSession("ws-1", "session-1");
    const second = await manager.ensureSession("ws-1", "session-1");
    const env = manager.getEnv("ws-1", "session-1");

    expect(second.port).toBe(first.port);
    expect(env).toMatchObject({
      AGENT_BROWSER_STREAM_PORT: String(first.port),
      AGENT_BROWSER_HIVE_WORKSPACE_ID: "ws-1",
      AGENT_BROWSER_HIVE_SESSION_ID: "session-1",
    });
  });

  it("marks sessions active when an agent-browser command is observed", async () => {
    await manager.ensureSession("ws-1", "session-1");
    const payload = manager.maybeMarkToolActivity(
      "ws-1",
      "session-1",
      "Bash",
      JSON.stringify({ command: "agent-browser open http://localhost:5173" }),
    );

    expect(payload).toMatchObject({
      sessionId: "session-1",
      state: "active",
      streamPath: "/ws/browser/ws-1/session-1",
    });
    expect(manager.getVisibleStatuses("ws-1")).toHaveLength(1);
  });

  it("ignores unrelated tool activity", async () => {
    await manager.ensureSession("ws-1", "session-1");
    const payload = manager.maybeMarkToolActivity(
      "ws-1",
      "session-1",
      "Bash",
      JSON.stringify({ command: "npm test" }),
    );

    expect(payload).toBeNull();
    expect(manager.getVisibleStatuses("ws-1")).toHaveLength(0);
  });

  it("ingests stream tab metadata without emitting frame traffic", async () => {
    const statuses: unknown[] = [];
    await manager.ensureSession("ws-1", "session-1");
    manager.on("status", (_workspaceId, status) => statuses.push(status));

    manager.ingestStreamMessage("ws-1", "session-1", JSON.stringify({
      type: "tabs",
      tabs: [{ url: "http://localhost:5173", title: "Hive", active: true }],
    }));

    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({
      state: "active",
      url: "http://localhost:5173",
      title: "Hive",
    });
  });
});
