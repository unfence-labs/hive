// ── Output scalar primitives (shared by backend + frontend) ──────────
//
// The single source for the two heavy-output scalars used by both the backend
// REST-history truncation (`computeTruncatedField`) and the frontend live
// scalar computation (`computeOutputScalars`). Keeping them here prevents the
// line-count / byte-length formulas from drifting between packages.

/**
 * Line count for a full output string after ignoring a single trailing newline
 * (which command/Grep/Glob output almost always carries).
 * Examples: ""=>0, "a"=>1, "a\n"=>1, "a\nb"=>2, "a\nb\n"=>2, "\n"=>0, "a\n\n"=>2.
 */
export function outputLineCount(s: string): number {
  if (s.length === 0) return 0;
  const body = s.endsWith("\n") ? s.slice(0, -1) : s;
  return body.length === 0 ? 0 : body.split("\n").length;
}

/** Exact UTF-8 byte length of a full output string. */
export function outputByteLength(s: string): number {
  // TextEncoder is available in both Node (18+) and the browser, so this single
  // implementation is portable across both consumers.
  return new TextEncoder().encode(s).length;
}

/** Convert provider/native output payloads into the string shape used by Hive. */
export function normalizeToolOutput(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";

  if (Array.isArray(value)) {
    const textBlocks = value
      .map((entry) => {
        if (!entry || typeof entry !== "object") return undefined;
        const record = entry as Record<string, unknown>;
        return record.type === "text" && typeof record.text === "string"
          ? record.text
          : undefined;
      })
      .filter((text): text is string => text !== undefined);
    if (textBlocks.length > 0) return textBlocks.join("\n\n");
  }

  try {
    const serialized = JSON.stringify(value);
    return serialized ?? String(value);
  } catch {
    return String(value);
  }
}

export interface AgentActivityFile {
  path: string;
  /** Full unified diff. Bounded by edit size; never truncated in REST history. */
  diff?: string;
  kind?: string;
  status?: string;
}

export type AgentActivityCommandAction =
  | { type: "read"; command?: string; name?: string; path: string }
  | { type: "listFiles"; command?: string; path?: string | null }
  | { type: "search"; command?: string; query?: string | null; path?: string | null }
  | { type: "unknown"; command?: string };

export interface AgentActivityToolCall {
  id: string;
  name: string;
  input: string;
  output?: string;
  parentToolUseId?: string;
}

export interface CommandExecutionToolSource {
  id: string;
  command?: string;
  cwd?: string;
  status?: string;
  output?: string;
  exitCode?: number;
  durationMs?: number;
  commandActions?: AgentActivityCommandAction[];
  parentToolUseId?: string;
}

export type AgentActivity =
  | {
      id: string;
      kind: "command_execution";
      command?: string;
      cwd?: string;
      status?: string;
      /**
       * Full command output. Present on live activities; OMITTED in REST history
       * when it exceeds the preview cap (fetch the full body via the tool-output
       * endpoint, keyed by this activity id). Read `outputPreview`/scalars for
       * the collapsed view instead. Mirrors the {@link AgentActivityToolCall}
       * / ToolCall sub-shape.
       */
      output?: string;
      /** First ~2 KB of the output (REST history). */
      outputPreview?: string;
      /** Line count of the FULL output after ignoring a single trailing newline. */
      outputLineCount?: number;
      /** Exact UTF-8 byte length of the FULL output. */
      outputByteLength?: number;
      /** True when the full body was omitted because it exceeded the preview cap. */
      outputTruncated?: boolean;
      exitCode?: number;
      durationMs?: number;
      commandActions?: AgentActivityCommandAction[];
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
      kind: "goal_update";
      active: boolean;
      threadId: string;
      objective?: string;
      status?: string;
      tokenBudget?: number | null;
      tokensUsed?: number;
      timeUsedSeconds?: number;
      createdAt?: number;
      updatedAt?: number;
    }
  | {
      id: string;
      kind: "image_view";
      path: string;
      relativePath?: string;
      imageUrl?: string;
      outsideWorkspace?: boolean;
    }
  | {
      id: string;
      kind: "image_generation";
      status?: string;
      revisedPrompt?: string;
      result?: string;
      savedPath?: string;
      relativePath?: string;
      imageUrl?: string;
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

export function commandExecutionActivityToToolCall(activity: CommandExecutionToolSource): AgentActivityToolCall {
  const classified = classifyCommandAction(activity);
  const fallbackInput = {
    command: activity.command ?? "",
    cwd: activity.cwd,
    status: activity.status,
    exitCode: activity.exitCode,
    durationMs: activity.durationMs,
  };

  return {
    id: activity.id,
    name: classified?.name ?? "Bash",
    input: JSON.stringify(classified?.input ?? fallbackInput),
    output: activity.output,
    parentToolUseId: activity.parentToolUseId,
  };
}

export function normalizeAgentActivityCommandActions(value: unknown): AgentActivityCommandAction[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const actions = value
    .map((entry): AgentActivityCommandAction | undefined => {
      if (!entry || typeof entry !== "object") return undefined;
      const record = entry as Record<string, unknown>;
      const type = typeof record.type === "string" ? record.type : undefined;
      const command = typeof record.command === "string" ? record.command : undefined;
      switch (type) {
        case "read": {
          const path = typeof record.path === "string" ? record.path : undefined;
          if (!path) return undefined;
          return {
            type,
            command,
            name: typeof record.name === "string" ? record.name : undefined,
            path,
          };
        }
        case "search":
          return {
            type,
            command,
            query: typeof record.query === "string" ? record.query : null,
            path: typeof record.path === "string" ? record.path : null,
          };
        case "listFiles":
          return {
            type,
            command,
            path: typeof record.path === "string" ? record.path : null,
          };
        case "unknown":
          return { type, command };
        default:
          return undefined;
      }
    })
    .filter((entry): entry is AgentActivityCommandAction => entry != null);
  return actions.length > 0 ? actions : undefined;
}

function classifyCommandAction(
  activity: CommandExecutionToolSource,
): { name: string; input: Record<string, unknown> } | undefined {
  const actions = activity.commandActions;
  // Only relabel commands when Codex gives one clear semantic action.
  if (!actions || actions.length !== 1) return undefined;

  const action = actions[0];
  const command = action.command ?? activity.command;
  const metadata = {
    command,
    cwd: activity.cwd,
    status: activity.status,
    exitCode: activity.exitCode,
    durationMs: activity.durationMs,
  };

  switch (action.type) {
    case "read":
      if (!action.path) return undefined;
      return {
        name: "Read",
        input: {
          file_path: action.path,
          path: action.path,
          name: action.name,
          ...metadata,
        },
      };
    case "search":
      if (!action.query) return undefined;
      return {
        name: "Grep",
        input: {
          pattern: action.query,
          path: action.path ?? undefined,
          ...metadata,
        },
      };
    case "listFiles":
      return {
        name: "Glob",
        input: {
          path: action.path ?? undefined,
          ...metadata,
        },
      };
    case "unknown":
      return undefined;
  }
}
