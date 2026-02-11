import { join } from "node:path";
import { nanoid } from "nanoid";
import { AgentProcess } from "./agent-process.js";
import { getWorkspace } from "../workspaces/workspace-manager.js";
import { saveProject, getDataDir } from "../state/state.js";
import type { Agent } from "../types.js";

const activeAgents = new Map<string, AgentProcess>();

export interface LaunchOptions {
  command?: string;
  args?: string[];
}

export async function launchAgent(
  wsId: string,
  prompt: string,
  dataDir = getDataDir(),
  options?: LaunchOptions
): Promise<Agent> {
  const result = await getWorkspace(wsId, dataDir);
  if (!result) throw new Error(`Workspace ${wsId} not found`);

  const { projectState, workspace } = result;
  if (workspace.status === "running") {
    throw new Error("Workspace is busy — an agent is already running");
  }

  const agentId = `agent-${nanoid(8)}`;
  const logsDir = join(dataDir, projectState.id, "logs");
  const logFile = join(logsDir, `${agentId}.log`);
  const wsPath = join(dataDir, projectState.id, "workspaces", workspace.name);

  const agent: Agent = {
    id: agentId,
    workspaceId: wsId,
    prompt,
    status: "running",
    startedAt: new Date().toISOString(),
    outputFile: logFile,
  };

  // Update state: workspace is now running, add agent to history
  workspace.status = "running";
  workspace.agents.push(agent);
  await saveProject(projectState, dataDir);

  // Create and start the process
  const proc = new AgentProcess({
    cwd: wsPath,
    prompt,
    logFile,
    command: options?.command,
    args: options?.args,
  });
  activeAgents.set(agentId, proc);

  // Handle agent completion
  const onFinish = async (exitCode: number) => {
    activeAgents.delete(agentId);

    try {
      // Reload state (may have changed)
      const fresh = await getWorkspace(wsId, dataDir);
      if (fresh) {
        const a = fresh.workspace.agents.find((a) => a.id === agentId);
        if (a) {
          a.status = exitCode === 0 ? "done" : "error";
          a.exitCode = exitCode;
          a.finishedAt = new Date().toISOString();
        }
        fresh.workspace.status = "idle";
        await saveProject(fresh.projectState, dataDir);
      }
    } catch {
      // State dir may have been cleaned up (e.g. in tests)
    }
  };

  proc.on("exit", (code) => void onFinish(code));
  proc.on("error", () => void onFinish(1));

  await proc.start();
  return agent;
}

export async function stopAgent(agentId: string): Promise<void> {
  const proc = activeAgents.get(agentId);
  if (!proc) throw new Error(`Agent ${agentId} is not running`);
  proc.stop();
}

export function getActiveProcess(agentId: string): AgentProcess | undefined {
  return activeAgents.get(agentId);
}

export async function getAgent(
  agentId: string,
  dataDir = getDataDir()
): Promise<Agent | null> {
  const { loadAllProjects } = await import("../state/state.js");
  const all = await loadAllProjects(dataDir);
  for (const project of all) {
    for (const ws of project.workspaces) {
      const agent = ws.agents.find((a) => a.id === agentId);
      if (agent) return agent;
    }
  }
  return null;
}

export async function listAgents(
  wsId: string,
  dataDir = getDataDir()
): Promise<Agent[]> {
  const result = await getWorkspace(wsId, dataDir);
  if (!result) throw new Error(`Workspace ${wsId} not found`);
  return result.workspace.agents;
}

/** For testing: clear all active agent references */
export function _clearActiveAgents(): void {
  for (const [, proc] of activeAgents) {
    proc.stop();
  }
  activeAgents.clear();
}
