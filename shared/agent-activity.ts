export interface AgentActivityFile {
  path: string;
  diff?: string;
  kind?: string;
  status?: string;
}

export type AgentActivity =
  | {
      id: string;
      kind: "command_execution";
      command?: string;
      cwd?: string;
      status?: string;
      output?: string;
      exitCode?: number;
      durationMs?: number;
    }
  | {
      id: string;
      kind: "file_change";
      status?: string;
      files: AgentActivityFile[];
    }
  | {
      id: string;
      kind: "plan_update";
      steps: Array<{ text: string; status: string }>;
    }
  | {
      id: string;
      kind: "diagnostic";
      severity: "info" | "warning" | "error";
      title: string;
      message: string;
      source?: string;
      method?: string;
      details?: string;
    };
