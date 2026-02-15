import { GitBranch, Folder } from "lucide-react";

interface WorkspaceWelcomeProps {
  projectName: string;
  workspaceName: string;
  branch: string;
  defaultBranch: string;
  fileCount: number;
}

export function WorkspaceWelcome({
  projectName,
  workspaceName,
  branch,
  defaultBranch,
  fileCount,
}: WorkspaceWelcomeProps) {
  return (
    <div className="flex w-full max-w-lg flex-col gap-6">
      <div className="w-full rounded-xl border border-border/50 bg-card px-5 py-4">
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
      </div>
    </div>
  );
}
