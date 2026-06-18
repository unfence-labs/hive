import { useState } from "react";
import { Terminal, Bot, GitBranch, MessageSquare, Settings, Brain, FolderTree, Globe, Cpu } from "lucide-react";
import { cn } from "@/lib/utils";

type FlowMode = "chat" | "brain" | "agent" | "automation";

export function PromptFlowExplainer() {
  const [mode, setMode] = useState<FlowMode>("chat");
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-medium text-foreground flex items-center gap-2">
            Prompt Assembly
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Understand how your prompts are assembled before being sent to the AI model.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-card/50 p-1">
          <button
            onClick={() => setMode("chat")}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
              mode === "chat" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Interactive Chat
          </button>
          <button
            onClick={() => setMode("brain")}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
              mode === "brain" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Brain
          </button>
          <button
            onClick={() => setMode("agent")}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
              mode === "agent" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Agent
          </button>
          <button
            onClick={() => setMode("automation")}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
              mode === "automation" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Automations
          </button>
        </div>
      </div>

      <div
        className="relative flex min-h-[400px] w-full items-stretch justify-between gap-8 md:gap-16 mt-4"
      >
        {/* Left Column: Sources */}
        <div className="z-10 flex w-64 flex-col justify-center gap-4 py-4">
          {mode === "chat" ? (
            <>
              <SourceCard
                id="harness"
                icon={<Cpu className="h-4 w-4" />}
                title="Native Harness Prompt"
                desc="Claude Code / Codex — not editable by Hive"
                isHovered={hoveredCard === "harness"}
                onHover={setHoveredCard}
              />
              <SourceCard
                id="base"
                icon={<Settings className="h-4 w-4" />}
                title="Build Agent Prompt"
                desc="Global instructions"
                isHovered={hoveredCard === "base"}
                onHover={setHoveredCard}
              />
              <SourceCard
                id="git"
                icon={<GitBranch className="h-4 w-4" />}
                title="Git Context"
                desc="Project, Branch, Status, Commits"
                isHovered={hoveredCard === "git"}
                onHover={setHoveredCard}
              />
              <SourceCard
                id="browser"
                icon={<Globe className="h-4 w-4" />}
                title="Browser Context"
                desc="agent-browser live preview hint"
                isHovered={hoveredCard === "browser"}
                onHover={setHoveredCard}
              />
              <SourceCard
                id="user"
                icon={<MessageSquare className="h-4 w-4" />}
                title="User Message"
                desc="File mentions & resized images"
                isHovered={hoveredCard === "user"}
                onHover={setHoveredCard}
              />
            </>
          ) : mode === "brain" ? (
            <>
              <SourceCard
                id="harness"
                icon={<Cpu className="h-4 w-4" />}
                title="Native Harness Prompt"
                desc="Claude Code / Codex — not editable by Hive"
                isHovered={hoveredCard === "harness"}
                onHover={setHoveredCard}
              />
              <SourceCard
                id="brain"
                icon={<Brain className="h-4 w-4" />}
                title="Brain Agent Prompt"
                desc="Global Brain instructions"
                isHovered={hoveredCard === "brain"}
                onHover={setHoveredCard}
              />
              <SourceCard
                id="brain-map"
                icon={<FolderTree className="h-4 w-4" />}
                title="Brain File Map"
                desc="Note paths only"
                isHovered={hoveredCard === "brain-map"}
                onHover={setHoveredCard}
              />
              <SourceCard
                id="brain-user"
                icon={<MessageSquare className="h-4 w-4" />}
                title="User Message"
                desc="File mentions & resized images"
                isHovered={hoveredCard === "brain-user"}
                onHover={setHoveredCard}
              />
            </>
          ) : mode === "agent" ? (
            <>
              <SourceCard
                id="harness"
                icon={<Cpu className="h-4 w-4" />}
                title="Native Harness Prompt"
                desc="Claude Code / Codex — not editable by Hive"
                isHovered={hoveredCard === "harness"}
                onHover={setHoveredCard}
              />
              <SourceCard
                id="agent-base"
                icon={<Bot className="h-4 w-4" />}
                title="Agent Instructions"
                desc="The Team Agent's role — its base prompt"
                isHovered={hoveredCard === "agent-base"}
                onHover={setHoveredCard}
              />
              <SourceCard
                id="agent-git"
                icon={<GitBranch className="h-4 w-4" />}
                title="Git Context"
                desc="Only for project-linked runs"
                isHovered={hoveredCard === "agent-git"}
                onHover={setHoveredCard}
              />
            </>
          ) : (
            <>
              <SourceCard
                id="harness"
                icon={<Cpu className="h-4 w-4" />}
                title="Native Harness Prompt"
                desc="Claude Code / Codex — not editable by Hive"
                isHovered={hoveredCard === "harness"}
                onHover={setHoveredCard}
              />
              <SourceCard
                id="task-agent"
                icon={<Bot className="h-4 w-4" />}
                title="Task Agent"
                desc="Agent instructions, model, permissions"
                isHovered={hoveredCard === "task-agent"}
                onHover={setHoveredCard}
              />
              <SourceCard
                id="git-auto"
                icon={<GitBranch className="h-4 w-4" />}
                title="Git Context"
                desc="Only for project-linked runs"
                isHovered={hoveredCard === "git-auto"}
                onHover={setHoveredCard}
              />
              <SourceCard
                id="user-auto"
                icon={<MessageSquare className="h-4 w-4" />}
                title="Run Prompt"
                desc="Inline text or prompt template"
                isHovered={hoveredCard === "user-auto"}
                onHover={setHoveredCard}
              />
            </>
          )}
        </div>

        {/* Right Column: Final Payload */}
        <div className="z-10 flex flex-1 flex-col justify-center py-4">
          <div
            className="flex h-full w-full flex-col overflow-hidden rounded-lg border border-border/50 bg-field shadow-sm"
          >
            <div className="flex items-center gap-2 border-b border-border/60 bg-muted/50 px-4 py-2">
              <Terminal className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Final Prompt Payload</span>
            </div>
            <div className="flex-1 overflow-auto p-4 font-mono text-[11px] leading-relaxed">
              {mode === "chat" ? (
                <>
                  <PayloadBlock id="harness" hoveredId={hoveredCard} color="text-muted-foreground">
                    {"# Native system prompt — provided by Claude Code / Codex. Hive appends its overlay below."}
                  </PayloadBlock>
                  <PayloadBlock id="base" hoveredId={hoveredCard} color="text-info-foreground">
                    --append-system-prompt "You are an AI coding agent...
                  </PayloadBlock>
                  <PayloadBlock id="git" hoveredId={hoveredCard} color="text-success-foreground">
                    {`\n\n# Git Context\nProject: Hive\nBranch: main\n...`}
                  </PayloadBlock>
                  <PayloadBlock id="browser" hoveredId={hoveredCard} color="text-warning-foreground">
                    {`\n\n# Browser Context\nHive provides a read-only live browser panel..."`}
                  </PayloadBlock>
                  <div className="my-2 border-t border-border/60" />
                  <PayloadBlock id="user" hoveredId={hoveredCard} color="text-foreground">
                    -p "Please refactor /absolute/path/to/file.ts..."
                  </PayloadBlock>
                </>
              ) : mode === "brain" ? (
                <>
                  <PayloadBlock id="harness" hoveredId={hoveredCard} color="text-muted-foreground">
                    {"# Native system prompt — provided by Claude Code / Codex. Hive appends its overlay below."}
                  </PayloadBlock>
                  <PayloadBlock id="brain" hoveredId={hoveredCard} color="text-info-foreground">
                    --append-system-prompt "You are the Brain agent...
                  </PayloadBlock>
                  <PayloadBlock id="brain-map" hoveredId={hoveredCard} color="text-primary">
                    {`\n\n# Brain Files\nnotes/ideas.md\nnotes/people/..."`}
                  </PayloadBlock>
                  <div className="my-2 border-t border-border/60" />
                  <PayloadBlock id="brain-user" hoveredId={hoveredCard} color="text-foreground">
                    -p "Summarize what we know about #notes/ideas.md..."
                  </PayloadBlock>
                </>
              ) : mode === "agent" ? (
                <>
                  <PayloadBlock id="harness" hoveredId={hoveredCard} color="text-muted-foreground">
                    {"# Native system prompt — provided by Claude Code / Codex. Hive appends its overlay below."}
                  </PayloadBlock>
                  <PayloadBlock id="agent-base" hoveredId={hoveredCard} color="text-primary">
                    --append-system-prompt "You are a security reviewer...
                  </PayloadBlock>
                  <PayloadBlock id="agent-git" hoveredId={hoveredCard} color="text-success-foreground">
                    {`\n\n# Git Context\nProject: Hive\n...\n\n// omitted when no project is linked`}
                  </PayloadBlock>
                  <PayloadBlock id="agent-note" hoveredId={hoveredCard} color="text-muted-foreground">
                    {`\n\n// + run prompt added at execution — see the Automations tab`}
                  </PayloadBlock>
                </>
              ) : (
                <>
                  <PayloadBlock id="harness" hoveredId={hoveredCard} color="text-muted-foreground">
                    {"# Native system prompt — provided by Claude Code / Codex. Hive appends its overlay below."}
                  </PayloadBlock>
                  <PayloadBlock id="task-agent" hoveredId={hoveredCard} color="text-primary">
                    --append-system-prompt "You are a security reviewer...
                  </PayloadBlock>
                  <PayloadBlock id="git-auto" hoveredId={hoveredCard} color="text-success-foreground">
                    {`\n\n# Git Context\nProject: Hive\n...\n\n// omitted when no project is linked`}
                  </PayloadBlock>
                  <div className="my-2 border-t border-border/60" />
                  <PayloadBlock id="user-auto" hoveredId={hoveredCard} color="text-foreground">
                    -p "Run the selected prompt template or inline run prompt..."
                  </PayloadBlock>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const SourceCard = ({ icon, title, desc, id, isHovered, onHover }: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  id: string;
  isHovered: boolean;
  onHover: (id: string | null) => void;
}) => {
  return (
    <div
      onMouseEnter={() => onHover(id)}
      onMouseLeave={() => onHover(null)}
      className={cn(
        "group relative flex cursor-default flex-col gap-1 rounded-xl border p-4 transition-all duration-300",
        isHovered
          ? "border-primary/50 bg-primary/10 shadow-[0_0_16px_var(--hive-accent-glow)]"
          : "border-border/50 bg-card/40 hover:border-primary/30"
      )}
    >
      <div className="flex items-center gap-2">
        <div className={cn("rounded-md p-1.5 transition-colors", isHovered ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
          {icon}
        </div>
        <span className={cn("text-sm font-medium transition-colors", isHovered ? "text-foreground" : "text-muted-foreground group-hover:text-foreground")}>
          {title}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{desc}</p>
    </div>
  );
};

const PayloadBlock = ({
  children,
  id,
  hoveredId,
  color,
}: {
  children: React.ReactNode;
  id: string;
  hoveredId: string | null;
  color: string;
}) => {
  const isActive = hoveredId === id || !hoveredId;
  return (
    <div
      className={cn(
        "rounded px-2 py-1.5 transition-all duration-300",
        isActive ? "opacity-100" : "opacity-30",
        hoveredId === id && "bg-muted/70"
      )}
    >
      <span className={color}>{children}</span>
    </div>
  );
};
