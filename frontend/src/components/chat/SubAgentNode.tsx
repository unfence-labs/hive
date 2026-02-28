import { useState, memo } from "react";
import type { ToolCall } from "@/types";
import type { SubAgentInfo } from "@/lib/sub-agent";
import { cn } from "@/lib/utils";
import { MessageResponse } from "@/components/ai-elements/message";
import { ContentPanel, ContentPanelBody, ContentPanelFooter } from "@/components/chat/ContentPanel";
import { ToolCallTree } from "@/components/chat/ToolCallList";

const svgProps = {
  className: "size-3.5",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function AgentIcon({ type }: { type: string }) {
  switch (type) {
    case "Explore":
      return (
        <svg {...svgProps}>
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      );
    case "Plan":
      return (
        <svg {...svgProps}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      );
    case "Bash":
      return (
        <svg {...svgProps}>
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      );
    default:
      return (
        <svg {...svgProps}>
          <path d="M12 8V4H8" />
          <rect width="16" height="12" x="4" y="8" rx="2" />
          <path d="M2 14h2" />
          <path d="M20 14h2" />
          <path d="M15 13v2" />
          <path d="M9 13v2" />
        </svg>
      );
  }
}

/** Parse a tool output as a JSON array of content blocks and extract text. */
function parseContentBlocks(output: string): string | null {
  try {
    const parsed = JSON.parse(output);
    if (!Array.isArray(parsed)) return null;
    const texts = parsed
      .filter(
        (b: unknown): b is { type: "text"; text: string } =>
          typeof b === "object" &&
          b !== null &&
          (b as Record<string, unknown>).type === "text" &&
          typeof (b as Record<string, unknown>).text === "string",
      )
      .map((b) => b.text);
    return texts.length > 0 ? texts.join("\n\n") : null;
  } catch {
    return null;
  }
}

interface SubAgentNodeProps {
  tool: ToolCall;
  info: SubAgentInfo;
  children: ToolCall[];
  childrenMap: Map<string, ToolCall[]>;
  showExecutingState?: boolean;
}

export const SubAgentNode = memo(function SubAgentNode({
  tool,
  info,
  children,
  childrenMap,
  showExecutingState,
}: SubAgentNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);

  const isRunning = showExecutingState ? tool.output === undefined : false;
  const isDone = tool.output !== undefined;
  const childCount = children.length;

  // Parse output for result footer
  const resultText = expanded && isDone && tool.output
    ? parseContentBlocks(tool.output)
    : null;

  return (
    <div>
      {/* Inline button row — same pattern as ChatToolUse */}
      <div className="my-0.5">
        <button
          type="button"
          className={cn(
            "inline-flex w-fit max-w-full items-center gap-2 rounded-md py-1 pr-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground",
            isRunning && "animate-shimmer",
          )}
          onClick={() => setExpanded(!expanded)}
        >
          <span
            className={cn(
              "shrink-0",
              isRunning && "text-primary",
              isDone && "text-green-500/80",
              !isRunning && !isDone && "text-muted-foreground",
            )}
          >
            <AgentIcon type={info.subagentType} />
          </span>
          <span>
            {info.subagentType}
          </span>
          {info.description && (
            <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
              {info.description}
            </code>
          )}
          {isDone && childCount > 0 && (
            <span className="text-muted-foreground/50">
              · {childCount} tool{childCount !== 1 ? "s" : ""}
            </span>
          )}
          {isRunning && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-1.5 animate-pulse rounded-full bg-primary" />
            </span>
          )}
          {isDone && (
            <svg className="size-3 shrink-0 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </button>
      </div>

      {/* Expanded: children indented with colored left border */}
      {expanded && (
        <div
          className={cn(
            "ml-4 border-l-2 pl-3",
            isRunning && "border-primary/40",
            isDone && "border-green-500/30",
            !isRunning && !isDone && "border-muted-foreground/20",
          )}
        >
          {/* Prompt toggle */}
          {info.prompt && (
            <div className="my-0.5">
              <button
                type="button"
                className="inline-flex w-fit items-center gap-2 rounded-md py-1 pr-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setPromptOpen(!promptOpen)}
              >
                <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <span>Prompt</span>
              </button>
              {promptOpen && (
                <ContentPanel>
                  <ContentPanelBody>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-muted-foreground">
                      {info.prompt}
                    </pre>
                  </ContentPanelBody>
                </ContentPanel>
              )}
            </div>
          )}

          {/* Child tools */}
          <ToolCallTree
            tools={children}
            childrenMap={childrenMap}
            showExecutingState={showExecutingState}
          />

          {/* Result footer (when expanded and done) */}
          {isDone && tool.output && (
            <ContentPanel className="my-1">
              <ContentPanelFooter>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                  Result
                </div>
                {resultText ? (
                  <div className="prose-sm max-h-96 overflow-auto text-muted-foreground">
                    <MessageResponse>{resultText}</MessageResponse>
                  </div>
                ) : (
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-muted-foreground">
                    {typeof tool.output === "string"
                      ? tool.output
                      : JSON.stringify(tool.output, null, 2)}
                  </pre>
                )}
              </ContentPanelFooter>
            </ContentPanel>
          )}
        </div>
      )}
    </div>
  );
});
