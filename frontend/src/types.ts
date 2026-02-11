export interface Project {
  id: string;
  name: string;
  url: string;
  createdAt: string;
  workspaces: Workspace[];
}

export interface Workspace {
  id: string;
  name: string;
  branch: string;
  status: "running" | "idle";
  createdAt: string;
  agents: Agent[];
}

export interface Agent {
  id: string;
  prompt: string;
  status: "running" | "done" | "error";
  exitCode?: number;
  startedAt: string;
  finishedAt?: string;
  outputFile?: string;
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
