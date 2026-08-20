import { FileTextIcon, SparklesIcon } from "lucide-react";
import { Github as GithubIcon } from "@react-symbols/icons";

interface BrainWelcomeProps {
  notesCount: number;
  repoUrl?: string;
}

/**
 * Empty-state welcome for the Brain chat, shown when a Brain session has no
 * messages yet. Mirrors the look of {@link WorkspaceWelcome} (headline card +
 * muted icon rows) but speaks to the Brain's knowledge-base framing instead of
 * a workspace branch. The optional repo row is rendered muted/truncated.
 */
export function BrainWelcome({ notesCount, repoUrl }: BrainWelcomeProps) {
  return (
    <div className="flex w-full max-w-lg flex-col gap-6">
      <div className="w-full rounded-xl border border-border/50 bg-sidebar px-5 py-4">
        <p className="text-center text-sm text-foreground">
          This is your <span className="font-semibold">Brain</span> — your
          personal knowledge base
        </p>
      </div>

      <div className="flex flex-col gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-3">
          <FileTextIcon className="size-4 shrink-0" />
          <span>
            {notesCount > 0 ? (
              <>
                <span className="font-medium text-foreground">
                  {notesCount.toLocaleString()}
                </span>{" "}
                {notesCount === 1 ? "note" : "notes"} so far
              </>
            ) : (
              <span className="font-medium text-foreground">No notes yet</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <SparklesIcon className="size-4 shrink-0" />
          <span>
            Ask the agent to{" "}
            <span className="font-medium text-foreground">find</span>,{" "}
            <span className="font-medium text-foreground">write</span>, or{" "}
            <span className="font-medium text-foreground">organize</span> your
            notes
          </span>
        </div>
        {repoUrl && (
          <div className="flex items-center gap-3">
            <GithubIcon className="size-4 shrink-0" />
            <span className="truncate text-muted-foreground/80">{repoUrl}</span>
          </div>
        )}
      </div>
    </div>
  );
}
