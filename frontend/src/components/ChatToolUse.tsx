import { useState, memo, type ReactNode } from "react";
import { diffLines } from "diff";
import { XCircleIcon } from "lucide-react";
import type { ToolCall } from "@/types";
import { cn } from "@/lib/utils";
import { formatElapsed } from "@/lib/time";
import { DiffView } from "@/components/diff/DiffView";
import { MessageResponse } from "@/components/ai-elements/message";
import { ContentPanel, ContentPanelBody, ContentPanelFooter } from "@/components/chat/ContentPanel";

const svgProps = { className: "size-3.5", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

const icons = {
  terminal: (
    <svg {...svgProps}>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  ),
  pencil: (
    <svg {...svgProps}>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  ),
  search: (
    <svg {...svgProps}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  ),
  globe: (
    <svg {...svgProps}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </svg>
  ),
  file: (
    <svg {...svgProps}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  ),
  bot: (
    <svg {...svgProps}>
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </svg>
  ),
  listChecks: (
    <svg {...svgProps}>
      <path d="M10 6h11" />
      <path d="M10 12h11" />
      <path d="M10 18h11" />
      <polyline points="3 6 4 7 6 5" />
      <polyline points="3 12 4 13 6 11" />
      <polyline points="3 18 4 19 6 17" />
    </svg>
  ),
  wrench: (
    <svg {...svgProps}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z" />
    </svg>
  ),
} as const;

export function getToolIcon(toolName: string): ReactNode {
  switch (toolName) {
    case "Read": case "Write": return icons.file;
    case "Edit": return icons.pencil;
    case "Bash": return icons.terminal;
    case "Grep": case "Glob": return icons.search;
    case "Task": return icons.bot;
    case "TaskCreate": case "TaskUpdate": case "TaskList": case "TaskGet": case "TodoList": return icons.listChecks;
    case "WebFetch": case "WebSearch": return icons.globe;
    default: return icons.wrench;
  }
}

function getFilename(path: string): string {
  return path.split("/").pop() ?? path;
}

/** Resolve file path across providers (Claude: file_path, Codex: filename). */
function resolveFilePath(input: Record<string, unknown>): string | undefined {
  return (input.file_path ?? input.filename) as string | undefined;
}

/** Parse a tool output as a JSON array of content blocks and extract text. */
function parseContentBlocks(output: string): string | null {
  try {
    const parsed = JSON.parse(output);
    if (!Array.isArray(parsed)) return null;
    const texts = parsed
      .filter((b: unknown): b is { type: "text"; text: string } =>
        typeof b === "object" && b !== null &&
        (b as Record<string, unknown>).type === "text" &&
        typeof (b as Record<string, unknown>).text === "string",
      )
      .map((b) => b.text);
    return texts.length > 0 ? texts.join("\n\n") : null;
  } catch {
    return null;
  }
}

function formatCommandMetadata(input: Record<string, unknown>): string | undefined {
  const command = input.command as string | undefined;
  const cwd = input.cwd as string | undefined;
  const exitCode = input.exitCode as number | undefined;
  const durationMs = input.durationMs as number | undefined;
  const parts = [
    command ? `$ ${command}` : undefined,
    cwd ? `cwd: ${cwd}` : undefined,
    exitCode !== undefined ? `exit ${exitCode}` : undefined,
    durationMs !== undefined ? formatElapsed(durationMs) : undefined,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join("\n") : undefined;
}

interface ToolDisplay {
  icon: ReactNode;
  label: string;
  detail?: string;
  expandedContent: ReactNode;
  hideOutput?: boolean;
}

function getToolDisplay(tool: ToolCall): ToolDisplay {
  let input: Record<string, unknown> = {};
  try {
    input = JSON.parse(tool.input);
  } catch {
    return {
      icon: icons.wrench,
      label: tool.name,
      expandedContent: tool.input,
    };
  }

  switch (tool.name) {
    case "Read": {
      const filePath = resolveFilePath(input);
      const filename = filePath ? getFilename(filePath) : undefined;
      const limit = input.limit as number | undefined;
      const offset = input.offset as number | undefined;
      const lineInfo = limit ? `${limit} lines` : "";
      return {
        icon: icons.file,
        label: lineInfo ? `Read ${lineInfo}` : "Read",
        detail: filename,
        expandedContent: filePath
          ? [
              `Path: ${filePath}${offset ? `\nOffset: ${offset}` : ""}${limit ? `\nLimit: ${limit}` : ""}`,
              formatCommandMetadata(input),
            ].filter(Boolean).join("\n\n")
          : "No file path specified",
      };
    }

    case "Edit": {
      const filePath = resolveFilePath(input);
      const filename = filePath ? getFilename(filePath) : undefined;
      const oldString = input.old_string as string | undefined;
      const newString = input.new_string as string | undefined;
      const diff = input.diff as string | undefined;
      return {
        icon: icons.pencil,
        label: "Edit",
        detail: filename,
        hideOutput: true,
        expandedContent: diff ? (
          <DiffView
            filePath={filePath}
            oldText=""
            newText=""
            unifiedDiff={diff}
            scrollClassName="max-h-96"
          />
        ) : filePath && (oldString !== undefined || newString !== undefined) ? (
          <DiffView
            filePath={filePath}
            oldText={oldString ?? ""}
            newText={newString ?? ""}
          />
        ) : filePath ? (
          `Path: ${filePath}\nNo diff available.`
        ) : (
          "No file path specified"
        ),
      };
    }

    case "Write": {
      const filePath = resolveFilePath(input);
      const filename = filePath ? getFilename(filePath) : undefined;
      const content = input.content as string | undefined;
      return {
        icon: icons.file,
        label: "Write",
        detail: filename,
        expandedContent: filePath ? (
          <DiffView
            filePath={filePath}
            oldText=""
            newText={content ?? ""}
          />
        ) : (
          "No file path specified"
        ),
      };
    }

    case "Bash": {
      const command = input.command as string | undefined;
      const description = input.description as string | undefined;
      const cwd = input.cwd as string | undefined;
      const exitCode = input.exitCode as number | undefined;
      const durationMs = input.durationMs as number | undefined;
      const truncated =
        command && command.length > 50
          ? command.substring(0, 50) + "..."
          : command;
      const metadata = [
        cwd ? `cwd: ${cwd}` : undefined,
        exitCode !== undefined ? `exit ${exitCode}` : undefined,
        durationMs !== undefined ? formatElapsed(durationMs) : undefined,
      ].filter(Boolean);
      return {
        icon: icons.terminal,
        label: "Bash",
        detail: truncated,
        expandedContent: [
          description,
          `$ ${command ?? "(no command)"}`,
          metadata.length > 0 ? metadata.join("\n") : undefined,
        ].filter(Boolean).join("\n\n"),
      };
    }

    case "Grep": {
      const pattern = input.pattern as string | undefined;
      const path = input.path as string | undefined;
      const glob = input.glob as string | undefined;
      return {
        icon: icons.search,
        label: "Grep",
        detail: pattern
          ? `"${pattern}"${path ? ` in ${getFilename(path)}` : ""}`
          : undefined,
        expandedContent: [
          `Pattern: ${pattern ?? "(none)"}\nPath: ${path ?? "(cwd)"}${glob ? `\nGlob: ${glob}` : ""}`,
          formatCommandMetadata(input),
        ].filter(Boolean).join("\n\n"),
      };
    }

    case "Glob": {
      const pattern = input.pattern as string | undefined;
      const path = input.path as string | undefined;
      return {
        icon: icons.search,
        label: "Glob",
        detail: pattern ?? path,
        expandedContent: [
          `Pattern: ${pattern ?? "(none)"}\nPath: ${path ?? "(cwd)"}`,
          formatCommandMetadata(input),
        ].filter(Boolean).join("\n\n"),
      };
    }

    case "Task": {
      const subagentType = input.subagent_type as string | undefined;
      const description = input.description as string | undefined;
      const prompt = input.prompt as string | undefined;
      return {
        icon: icons.bot,
        label: subagentType ? `Task (${subagentType})` : "Task",
        detail: description,
        expandedContent: prompt ?? description ?? "No prompt specified",
      };
    }

    case "WebFetch":
    case "WebSearch": {
      const url = input.url as string | undefined;
      const query = input.query as string | undefined;
      const prompt = input.prompt as string | undefined;
      return {
        icon: icons.globe,
        label: tool.name,
        detail: url ?? query,
        expandedContent: url
          ? `URL: ${url}${prompt ? `\n\nPrompt: ${prompt}` : ""}`
          : `Query: ${query ?? "(none)"}`,
      };
    }

    case "TaskCreate": {
      const subject = input.subject as string | undefined;
      const description = input.description as string | undefined;
      return {
        icon: icons.listChecks,
        label: "TaskCreate",
        detail: subject,
        expandedContent: description
          ? `Subject: ${subject}\n\nDescription:\n${description}`
          : `Subject: ${subject ?? "(none)"}`,
      };
    }

    case "TaskUpdate": {
      const taskId = input.taskId as string | undefined;
      const status = input.status as string | undefined;
      const detail = [taskId && `#${taskId}`, status].filter(Boolean).join(" → ");
      return {
        icon: icons.listChecks,
        label: "TaskUpdate",
        detail: detail || undefined,
        expandedContent: JSON.stringify(input, null, 2),
      };
    }

    case "TaskList":
      return {
        icon: icons.listChecks,
        label: "TaskList",
        expandedContent: "Lists all active tasks",
      };

    case "TaskGet": {
      const taskId = input.taskId as string | undefined;
      return {
        icon: icons.listChecks,
        label: "TaskGet",
        detail: taskId ? `#${taskId}` : undefined,
        expandedContent: taskId ? `Task ID: ${taskId}` : "No task ID specified",
      };
    }

    case "TodoList": {
      const items = Array.isArray(input.items) ? input.items : [];
      const completed = items.filter((item) =>
        item && typeof item === "object" && Boolean((item as Record<string, unknown>).completed),
      ).length;
      return {
        icon: icons.listChecks,
        label: "TodoList",
        detail: `${completed}/${items.length} complete`,
        expandedContent: JSON.stringify(input, null, 2),
      };
    }

    default:
      return {
        icon: icons.wrench,
        label: tool.name,
        expandedContent: JSON.stringify(input, null, 2),
      };
  }
}

interface ChatToolUseProps {
  tool: ToolCall;
  isExecuting?: boolean;
  onClick?: () => void;
}

type ToolStats =
  | { type: "diff"; added: number; removed: number }
  | { type: "plain"; label: string };

/** Count +/- lines in a unified diff string (Codex file_change format). */
function parseDiffStats(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added++;
    else if (line.startsWith("-") && !line.startsWith("---")) removed++;
  }
  return { added, removed };
}

function getToolStats(tool: ToolCall): ToolStats | null {
  let input: Record<string, unknown> = {};
  try { input = JSON.parse(tool.input); } catch { return null; }

  switch (tool.name) {
    case "Edit": {
      const oldString = input.old_string as string | undefined;
      const newString = input.new_string as string | undefined;
      const diff = input.diff as string | undefined;
      if (diff) {
        // Codex format: unified diff string
        const stats = parseDiffStats(diff);
        return stats.added || stats.removed ? { type: "diff", ...stats } : null;
      }
      if (!oldString && !newString) return null;
      const parts = diffLines(oldString ?? "", newString ?? "");
      let added = 0, removed = 0;
      for (const part of parts) {
        const lines = part.value.replace(/\n$/, "").split("\n").length;
        if (part.added) added += lines;
        else if (part.removed) removed += lines;
      }
      return added || removed ? { type: "diff", added, removed } : null;
    }
    case "Write": {
      const content = (input.content as string | undefined) ?? "";
      if (!content) return null;
      const lineCount = content.split("\n").length;
      return { type: "diff", added: lineCount, removed: 0 };
    }
    case "Grep": {
      if (!tool.output) return null;
      const lines = tool.output.split("\n").filter(Boolean);
      return lines.length ? { type: "plain", label: `${lines.length} result${lines.length !== 1 ? "s" : ""}` } : null;
    }
    case "Glob": {
      if (!tool.output) return null;
      const lines = tool.output.split("\n").filter(Boolean);
      return lines.length ? { type: "plain", label: `${lines.length} file${lines.length !== 1 ? "s" : ""}` } : null;
    }
    default:
      return null;
  }
}

function getOutputSummary(tool: ToolCall): string | undefined {
  if (tool.output == null) return undefined;
  const text = typeof tool.output === "string" ? tool.output : JSON.stringify(tool.output);
  if (text.length === 0) return undefined;
  const lines = text.split("\n").filter(Boolean);
  if (lines.length === 1 && lines[0].length < 60) return lines[0];
  if (lines.length > 1) return `${lines.length} lines`;
  return undefined;
}

function getBashMetadata(tool: ToolCall): { exitCode?: number; failed: boolean } | null {
  if (tool.name !== "Bash") return null;

  try {
    const input = JSON.parse(tool.input) as Record<string, unknown>;
    const exitCode = typeof input.exitCode === "number" ? input.exitCode : undefined;
    const status = typeof input.status === "string" ? input.status.toLowerCase() : "";
    const failed = exitCode !== undefined ? exitCode !== 0 : status === "failed" || status === "error";
    return { exitCode, failed };
  } catch {
    return null;
  }
}

export function ToolExpandedContent({ content }: { content: ReactNode }) {
  return typeof content === "string" ? (
    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-muted-foreground">
      {content}
    </pre>
  ) : (
    content
  );
}

const ChatToolUse = memo(function ChatToolUse({ tool, isExecuting, onClick }: ChatToolUseProps) {
  const [expanded, setExpanded] = useState(false);
  const display = getToolDisplay(tool);
  const showExpanded = onClick ? false : expanded;
  const stats = !isExecuting ? getToolStats(tool) : null;
  const summary = !isExecuting && !showExpanded && !stats ? getOutputSummary(tool) : undefined;
  const bashMetadata = !isExecuting ? getBashMetadata(tool) : null;
  const taskOutputText = tool.name === "Task" && tool.output
    ? parseContentBlocks(tool.output)
    : null;

  return (
    <div className="chat-surface my-0.5">
      <button
        type="button"
        className={cn(
          "inline-flex w-fit max-w-full items-center gap-2 rounded-md py-1 pr-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground",
          isExecuting && "animate-shimmer",
        )}
        onClick={onClick ?? (() => setExpanded(!expanded))}
        aria-expanded={onClick ? undefined : expanded}
      >
        <span className="shrink-0">{display.icon}</span>
        <span>{display.label}</span>
        {display.detail && (
          <code className="truncate rounded bg-[var(--chat-chrome)] px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
            {display.detail}
          </code>
        )}
        {stats?.type === "diff" && (
          <span className="flex items-center gap-1 font-mono text-xs">
            {stats.added > 0 && <span className="text-green-500">+{stats.added}</span>}
            {stats.removed > 0 && <span className="text-red-500">&minus;{stats.removed}</span>}
          </span>
        )}
        {stats?.type === "plain" && (
          <span className="truncate text-xs font-normal text-muted-foreground/60">{stats.label}</span>
        )}
        {bashMetadata?.failed && (
          <XCircleIcon
            className="size-3.5 shrink-0 text-destructive"
            aria-label={
              bashMetadata.exitCode !== undefined
                ? `Bash failed with exit code ${bashMetadata.exitCode}`
                : "Bash failed"
            }
          />
        )}
        {isExecuting && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-1.5 animate-pulse rounded-full bg-primary" />
          </span>
        )}
        {summary && (
          <span className="truncate text-xs font-normal text-muted-foreground/60">{summary}</span>
        )}
      </button>
      {showExpanded && (
        <ContentPanel>
          <ContentPanelBody>
            <ToolExpandedContent content={display.expandedContent} />
          </ContentPanelBody>
          {tool.output !== undefined && !display.hideOutput && (
            <ContentPanelFooter>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50">Output</div>
              {taskOutputText ? (
                <div className="prose-sm max-h-96 overflow-auto text-muted-foreground">
                  <MessageResponse>{taskOutputText}</MessageResponse>
                </div>
              ) : (
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-muted-foreground">
                  {typeof tool.output === "string" ? tool.output : JSON.stringify(tool.output, null, 2)}
                </pre>
              )}
            </ContentPanelFooter>
          )}
        </ContentPanel>
      )}
    </div>
  );
});

export default ChatToolUse;
