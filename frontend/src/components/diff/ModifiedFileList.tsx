import { cn } from "@/lib/utils";
import { FilePlusIcon, FileMinusIcon, FileIcon, PencilIcon } from "lucide-react";
import type { DiffFileStat, DiffFileStatus } from "@/types";

interface ModifiedFileListProps {
  committed: DiffFileStat[];
  uncommitted: DiffFileStat[];
  loading: boolean;
  onFileClick: (filePath: string) => void;
}

const STATUS_ICON: Record<DiffFileStatus, typeof FileIcon> = {
  added: FilePlusIcon,
  modified: PencilIcon,
  deleted: FileMinusIcon,
  renamed: FileIcon,
};

const STATUS_COLOR: Record<DiffFileStatus, string> = {
  added: "text-green-500",
  modified: "text-blue-500",
  deleted: "text-red-500",
  renamed: "text-yellow-500",
};

function FileRow({
  stat,
  onFileClick,
}: {
  stat: DiffFileStat;
  onFileClick: (filePath: string) => void;
}) {
  const Icon = STATUS_ICON[stat.status];
  return (
    <button
      key={stat.file}
      type="button"
      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs font-mono hover:bg-muted/50"
      onClick={() => onFileClick(stat.file)}
    >
      <Icon
        className={cn("size-3.5 shrink-0", STATUS_COLOR[stat.status])}
      />
      <span className="min-w-0 flex-1 truncate">
        {stat.file.split("/").pop()}
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
      <span>{label}</span>
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
  loading,
  onFileClick,
}: ModifiedFileListProps) {
  if (loading) {
    return (
      <div className="px-2 py-1 text-xs text-muted-foreground">Loading...</div>
    );
  }
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
