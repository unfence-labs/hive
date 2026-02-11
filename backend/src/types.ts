export interface Project {
  id: string;
  name: string;
  url: string;
  createdAt: string;
}

export type WorkspaceStatus = "idle" | "running";

export interface Workspace {
  id: string;
  name: string;
  projectId: string;
  branch: string;
  status: WorkspaceStatus;
  createdAt: string;
  agents: Agent[];
}

export type AgentStatus = "running" | "done" | "error";

export interface Agent {
  id: string;
  workspaceId: string;
  prompt: string;
  status: AgentStatus;
  exitCode?: number;
  startedAt: string;
  finishedAt?: string;
  outputFile: string;
}

export interface ProjectState {
  id: string;
  name: string;
  url: string;
  createdAt: string;
  workspaces: Workspace[];
}

export interface CreateProjectRequest {
  url: string;
}

export interface CreateAgentRequest {
  prompt: string;
}

export interface WsMessage {
  type: "stdout" | "stderr" | "status" | "exit";
  data?: string;
  code?: number;
  ts: number;
}
