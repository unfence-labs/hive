import { GitBranch, Folder, TerminalSquareIcon } from "lucide-react";

interface WorkspaceWelcomeProps {
  projectName: string;
  workspaceName: string;
  branch: string;
  defaultBranch: string;
  fileCount: number;
  /** When provided, render a button to open a terminal tab in this workspace. */
  onStartTerminal?: () => void;
}

export function WorkspaceWelcome({
  projectName,
  workspaceName,
  branch,
  defaultBranch,
  fileCount,
  onStartTerminal,
}: WorkspaceWelcomeProps) {
  return (
    <div className="flex w-full max-w-lg flex-col gap-6">
      <div className="w-full rounded-xl border border-border/50 bg-sidebar px-5 py-4">
        <p className="text-sm text-foreground">
          You're in a new copy of{" "}
          <span className="font-semibold">{projectName}</span> called{" "}
          <span className="font-semibold">{workspaceName}</span>
        </p>
      </div>

      <div className="flex flex-col gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-3">
          <GitBranch className="size-4 shrink-0" />
          <span>
            Branched{" "}
            <span className="font-medium text-foreground">{branch}</span> from{" "}
            <span className="font-medium text-foreground">
              origin/{defaultBranch}
            </span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Folder className="size-4 shrink-0" />
          <span>
            Created{" "}
            <span className="font-medium text-foreground">{workspaceName}</span>{" "}
            and copied{" "}
            <span className="font-medium text-foreground">
              {fileCount.toLocaleString()}
            </span>{" "}
            files
          </span>
        </div>
        {onStartTerminal && (
          <div className="flex items-center gap-3">
            <TerminalSquareIcon className="size-4 shrink-0" />
            <span>
              You can{" "}
              <button
                type="button"
                onClick={onStartTerminal}
                className="cursor-pointer font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
              >
                start a terminal
              </button>{" "}
              in this workspace
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
