import { useState, memo, type ReactNode } from "react";
import type { ToolCall } from "@/types";
import { cn } from "@/lib/utils";
import { DiffView } from "@/components/diff/DiffView";

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
  wrench: (
    <svg {...svgProps}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z" />
    </svg>
  ),
} as const;

function getFilename(path: string): string {
  return path.split("/").pop() ?? path;
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
      const filePath = input.file_path as string | undefined;
      const filename = filePath ? getFilename(filePath) : undefined;
      const limit = input.limit as number | undefined;
      const offset = input.offset as number | undefined;
      const lineInfo = limit ? `${limit} lines` : "";
      return {
        icon: icons.file,
        label: lineInfo ? `Read ${lineInfo}` : "Read",
        detail: filename,
        expandedContent: filePath
          ? `Path: ${filePath}${offset ? `\nOffset: ${offset}` : ""}${limit ? `\nLimit: ${limit}` : ""}`
          : "No file path specified",
      };
    }

    case "Edit": {
      const filePath = input.file_path as string | undefined;
      const filename = filePath ? getFilename(filePath) : undefined;
      const oldString = input.old_string as string | undefined;
      const newString = input.new_string as string | undefined;
      return {
        icon: icons.pencil,
        label: "Edit",
        detail: filename,
        hideOutput: true,
        expandedContent: filePath ? (
          <DiffView
            filePath={filePath}
            oldText={oldString ?? ""}
            newText={newString ?? ""}
          />
        ) : (
          "No file path specified"
        ),
      };
    }

    case "Write": {
      const filePath = input.file_path as string | undefined;
      const filename = filePath ? getFilename(filePath) : undefined;
      const content = input.content as string | undefined;
      return {
        icon: icons.file,
        label: "Write",
        detail: filename,
        expandedContent: filePath
          ? `Path: ${filePath}\n\nContent:\n${content ?? "(empty)"}`
          : "No file path specified",
      };
    }

    case "Bash": {
      const command = input.command as string | undefined;
      const description = input.description as string | undefined;
      const truncated =
        command && command.length > 50
          ? command.substring(0, 50) + "..."
          : command;
      return {
        icon: icons.terminal,
        label: "Bash",
        detail: truncated,
        expandedContent: description
          ? `${description}\n\n$ ${command}`
          : `$ ${command ?? "(no command)"}`,
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
        expandedContent: `Pattern: ${pattern ?? "(none)"}\nPath: ${path ?? "(cwd)"}${glob ? `\nGlob: ${glob}` : ""}`,
      };
    }

    case "Glob": {
      const pattern = input.pattern as string | undefined;
      const path = input.path as string | undefined;
      return {
        icon: icons.search,
        label: "Glob",
        detail: pattern,
        expandedContent: `Pattern: ${pattern ?? "(none)"}\nPath: ${path ?? "(cwd)"}`,
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

const ChatToolUse = memo(function ChatToolUse({ tool, isExecuting }: ChatToolUseProps) {
  const [expanded, setExpanded] = useState(false);
  const display = getToolDisplay(tool);
  const summary = !isExecuting && !expanded ? getOutputSummary(tool) : undefined;

  return (
    <div className="my-0.5">
      <button
        type="button"
        className={cn(
          "inline-flex w-fit items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground",
          isExecuting && "animate-shimmer",
        )}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="shrink-0">{display.icon}</span>
        <span>{display.label}</span>
        {display.detail && (
          <code className="truncate rounded bg-muted/60 px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
            {display.detail}
          </code>
        )}
        {isExecuting && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-1.5 animate-pulse rounded-full bg-primary" />
          </span>
        )}
        {summary && (
          <span className="text-xs font-normal text-muted-foreground/60">{summary}</span>
        )}
      </button>
      {expanded && (
        <div className="mt-1 rounded bg-muted/40 px-2 py-1.5 text-xs">
          <div className="mb-1">
            {typeof display.expandedContent === "string" ? (
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-muted-foreground">
                {display.expandedContent}
              </pre>
            ) : (
              display.expandedContent
            )}
          </div>
          {tool.output !== undefined && !display.hideOutput && (
            <div>
              <div className="mb-0.5 text-[11px] font-semibold text-muted-foreground/70">Result</div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-muted-foreground">
                {tool.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default ChatToolUse;
