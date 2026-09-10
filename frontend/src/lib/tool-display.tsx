import type { ReactNode } from "react";
import { diffLines } from "diff";
import type { ToolCall } from "@/types";
import { formatElapsed } from "@/lib/time";
import { DiffView } from "@/components/diff/DiffView";

/** One-line summary of a tool output for a collapsed step line. */
export function getOutputSummary(tool: ToolCall): string | undefined {
  if (tool.output == null) return undefined;
  const text = typeof tool.output === "string" ? tool.output : JSON.stringify(tool.output);
  if (text.length === 0) return undefined;
  const lines = text.split("\n").filter(Boolean);
  if (lines.length === 1 && lines[0].length < 60) return lines[0];
  if (lines.length > 1) return `${lines.length} lines`;
  return undefined;
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

export function getFilename(path: string): string {
  return path.split("/").pop() ?? path;
}

/** Resolve file path across providers (Claude: file_path, Codex: filename). */
function resolveFilePath(input: Record<string, unknown>): string | undefined {
  return (input.file_path ?? input.filename) as string | undefined;
}

/** Parse a tool output as a JSON array of content blocks and extract text. */
export function parseContentBlocks(output: string): string | null {
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

export interface ToolDisplay {
  detail?: string;
  expandedContent: ReactNode;
  hideOutput?: boolean;
}

export function parseToolInput(value: string): Record<string, unknown> | null {
  try {
    const input: unknown = JSON.parse(value);
    return input !== null && typeof input === "object" && !Array.isArray(input)
      ? input as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function getToolDisplay(tool: ToolCall): ToolDisplay {
  const input = parseToolInput(tool.input);
  if (!input) return { expandedContent: tool.input };

  switch (tool.name) {
    case "Read": {
      const filePath = resolveFilePath(input);
      const filename = filePath ? getFilename(filePath) : undefined;
      const limit = input.limit as number | undefined;
      const offset = input.offset as number | undefined;
      return {
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
        detail: pattern ?? path,
        expandedContent: [
          `Pattern: ${pattern ?? "(none)"}\nPath: ${path ?? "(cwd)"}`,
          formatCommandMetadata(input),
        ].filter(Boolean).join("\n\n"),
      };
    }

    case "Task": {
      const description = input.description as string | undefined;
      const prompt = input.prompt as string | undefined;
      return {
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
        detail: detail || undefined,
        expandedContent: JSON.stringify(input, null, 2),
      };
    }

    case "TaskList":
      return {
        expandedContent: "Lists all active tasks",
      };

    case "TaskGet": {
      const taskId = input.taskId as string | undefined;
      return {
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
        detail: `${completed}/${items.length} complete`,
        expandedContent: JSON.stringify(input, null, 2),
      };
    }

    default:
      return {
        expandedContent: JSON.stringify(input, null, 2),
      };
  }
}

export type ToolStats =
  | { type: "diff"; added: number; removed: number }
  | { type: "plain"; label: string };

/** Count +/- lines in a unified diff string (Codex file_change format). */
export function parseDiffStats(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added++;
    else if (line.startsWith("-") && !line.startsWith("---")) removed++;
  }
  return { added, removed };
}

export function getToolStats(tool: ToolCall): ToolStats | null {
  const input = parseToolInput(tool.input);
  if (!input) return null;

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

export function getBashMetadata(tool: ToolCall): { exitCode?: number; failed: boolean } | null {
  if (tool.name !== "Bash") return null;
  const input = parseToolInput(tool.input);
  if (!input) return null;
  const exitCode = typeof input.exitCode === "number" ? input.exitCode : undefined;
  const status = typeof input.status === "string" ? input.status.toLowerCase() : "";
  const failed = exitCode !== undefined ? exitCode !== 0 : status === "failed" || status === "error";
  return { exitCode, failed };
}
