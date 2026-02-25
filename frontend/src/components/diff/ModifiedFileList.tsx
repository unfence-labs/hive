import type { DiffFileStat } from "@/types";

interface ModifiedFileListProps {
  committed: DiffFileStat[];
  uncommitted: DiffFileStat[];
  onFileClick: (filePath: string) => void;
}

function FileRow({
  stat,
  onFileClick,
}: {
  stat: DiffFileStat;
  onFileClick: (filePath: string) => void;
}) {
  return (
    <button
      key={stat.file}
      type="button"
      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs font-mono hover:bg-muted/50"
      onClick={() => onFileClick(stat.file)}
    >
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {stat.file.includes("/") && stat.file.slice(0, stat.file.lastIndexOf("/") + 1)}
        <span className="text-foreground">{stat.file.split("/").pop()}</span>
      </span>
      {stat.additions > 0 && (
        <span className="shrink-0 text-green-500">
          +{stat.additions}
        </span>
      )}
      {stat.deletions > 0 && (
        <span className="shrink-0 text-red-500">
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
        <span className="text-green-500">+{totalAdditions}</span>
      )}
      {totalDeletions > 0 && (
        <span className="text-red-500">-{totalDeletions}</span>
      )}
    </div>
  );
}

export function ModifiedFileList({
  committed,
  uncommitted,
  onFileClick,
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
          <SectionHeader label="Uncommitted" stats={uncommitted} />
          <div className="space-y-0.5">
            {uncommitted.map((stat) => (
              <FileRow key={stat.file} stat={stat} onFileClick={onFileClick} />
            ))}
          </div>
        </div>
      )}
      {committed.length > 0 && (
        <div className={uncommitted.length > 0 ? "mt-3" : ""}>
          <SectionHeader label="Committed" stats={committed} />
          <div className="space-y-0.5">
            {committed.map((stat) => (
              <FileRow key={stat.file} stat={stat} onFileClick={onFileClick} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
