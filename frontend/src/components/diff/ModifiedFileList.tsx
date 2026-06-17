import { cn } from "@/lib/utils";
import type { DiffFileStat, DiffScope } from "@/types";

interface ModifiedFileListProps {
  committed: DiffFileStat[];
  uncommitted: DiffFileStat[];
  onFileClick: (filePath: string, scope: DiffScope) => void;
  activeFile?: string;
  activeScope?: DiffScope;
}

function FileRow({
  stat,
  scope,
  onFileClick,
  isActive,
}: {
  stat: DiffFileStat;
  scope: DiffScope;
  onFileClick: (filePath: string, scope: DiffScope) => void;
  isActive: boolean;
}) {
  return (
    <button
      key={stat.file}
      type="button"
      className={cn(
        "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs font-mono hover:bg-muted/50",
        isActive && "bg-primary/10 ring-1 ring-primary/20",
      )}
      onClick={() => onFileClick(stat.file, scope)}
    >
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {stat.file.includes("/") && stat.file.slice(0, stat.file.lastIndexOf("/") + 1)}
        <span className="text-foreground">{stat.file.split("/").pop()}</span>
      </span>
      {stat.additions > 0 && (
        <span className="shrink-0 text-success-foreground">
          +{stat.additions}
        </span>
      )}
      {stat.deletions > 0 && (
        <span className="shrink-0 text-destructive">
          -{stat.deletions}
        </span>
      )}
    </button>
  );
}

function SectionHeader({ label, stats }: { label: string; stats: DiffFileStat[] }) {
  const totalAdditions = stats.reduce((sum, s) => sum + s.additions, 0);
  const totalDeletions = stats.reduce((sum, s) => sum + s.deletions, 0);
  return (
    <div className="flex items-center gap-2 px-2 pb-1 pt-2 text-[10px] uppercase tracking-wider text-muted-foreground">
      <span className="font-semibold text-foreground">{label}</span>
      <span className="text-muted-foreground/60">{stats.length}</span>
      {totalAdditions > 0 && (
        <span className="text-success-foreground">+{totalAdditions}</span>
      )}
      {totalDeletions > 0 && (
        <span className="text-destructive">-{totalDeletions}</span>
      )}
    </div>
  );
}

export function ModifiedFileList({
  committed,
  uncommitted,
  onFileClick,
  activeFile,
  activeScope,
}: ModifiedFileListProps) {
  if (committed.length === 0 && uncommitted.length === 0) {
    return (
      <div className="px-2 py-1 text-xs text-muted-foreground">
        No changes.
      </div>
    );
  }

  return (
    <div>
      {uncommitted.length > 0 && (
        <div>
          <SectionHeader label="Working tree" stats={uncommitted} />
          <div className="space-y-0.5">
            {uncommitted.map((stat) => (
              <FileRow
                key={stat.file}
                stat={stat}
                scope="uncommitted"
                onFileClick={onFileClick}
                isActive={stat.file === activeFile && activeScope === "uncommitted"}
              />
            ))}
          </div>
        </div>
      )}
      {committed.length > 0 && (
        <div className={uncommitted.length > 0 ? "mt-3" : ""}>
          <SectionHeader label="Branch commits" stats={committed} />
          <div className="space-y-0.5">
            {committed.map((stat) => (
              <FileRow
                key={stat.file}
                stat={stat}
                scope="committed"
                onFileClick={onFileClick}
                isActive={stat.file === activeFile && activeScope === "committed"}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
