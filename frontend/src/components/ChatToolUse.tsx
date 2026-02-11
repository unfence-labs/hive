import { useState } from "react";
import type { ToolCall } from "@/types";
import { cn } from "@/lib/utils";

const toolIcons: Record<string, string> = {
  Read: "file-text",
  Edit: "pencil",
  Write: "file-plus",
  Bash: "terminal",
  Glob: "search",
  Grep: "search",
  WebFetch: "globe",
  WebSearch: "globe",
  Task: "list",
};

function ToolIcon({ name }: { name: string }) {
  const base = name.split("/").pop() ?? name;
  const icon = toolIcons[base];
  if (icon === "terminal") {
    return (
      <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    );
  }
  if (icon === "pencil") {
    return (
      <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      </svg>
    );
  }
  if (icon === "search") {
    return (
      <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
    );
  }
  if (icon === "globe") {
    return (
      <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
        <path d="M2 12h20" />
      </svg>
    );
  }
  if (icon === "file-plus" || icon === "file-text") {
    return (
      <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
        <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      </svg>
    );
  }
  return (
    <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z" />
    </svg>
  );
}

function formatInput(input: string): string {
  try {
    const parsed = JSON.parse(input);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return input;
  }
}

interface ChatToolUseProps {
  tool: ToolCall;
  isExecuting?: boolean;
}

export default function ChatToolUse({ tool, isExecuting }: ChatToolUseProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-1.5 rounded-md border bg-muted/50">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/80"
        onClick={() => setExpanded(!expanded)}
      >
        <ToolIcon name={tool.name} />
        <span className="font-medium">{tool.name}</span>
        {isExecuting && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block size-2 animate-pulse rounded-full bg-primary" />
            Running...
          </span>
        )}
        <svg
          className={cn("ml-auto size-4 text-muted-foreground transition-transform", expanded && "rotate-180")}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {expanded && (
        <div className="border-t px-3 py-2 text-xs">
          {tool.input && (
            <div className="mb-2">
              <div className="mb-1 font-semibold text-muted-foreground">Input</div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono">
                {formatInput(tool.input)}
              </pre>
            </div>
          )}
          {tool.output !== undefined && (
            <div>
              <div className="mb-1 font-semibold text-muted-foreground">Result</div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono">
                {tool.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
