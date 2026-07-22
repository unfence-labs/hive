import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ChevronDownIcon, CircleDot, GitBranch, GitPullRequest, SearchIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useProjects } from "@/hooks/useProjects";
import { useWorkspaceSources } from "@/hooks/useWorkspaceSources";
import type { CreateWorkspaceSource } from "@/types";

type SourceTab = "pulls" | "branches" | "issues";

const TABS: Array<{ id: SourceTab; label: string }> = [
  { id: "pulls", label: "Pull requests" },
  { id: "branches", label: "Branches" },
  { id: "issues", label: "Issues" },
];

const SEARCH_PLACEHOLDER: Record<SourceTab, string> = {
  pulls: "Search by title, number, or author",
  branches: "Search branches",
  issues: "Search by title, number, or author",
};

interface PickerRow {
  key: string;
  icon: "pr" | "pr-draft" | "branch" | "issue";
  prefix?: string;
  label: string;
  detail?: string;
  /** Set when the branch/PR is already checked out — row opens that workspace. */
  workspaceId?: string;
  source?: CreateWorkspaceSource;
}

interface NewWorkspaceFromDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultProjectId?: string;
}

function RowIcon({ icon }: { icon: PickerRow["icon"] }) {
  if (icon === "pr") return <GitPullRequest className="size-4 shrink-0 text-pr-open" />;
  if (icon === "pr-draft") return <GitPullRequest className="size-4 shrink-0 text-pr-draft" />;
  if (icon === "issue") return <CircleDot className="size-4 shrink-0 text-pr-open" />;
  return <GitBranch className="size-4 shrink-0 text-muted-foreground" />;
}

/** ⌘⇧N picker: create a workspace from a PR, branch, or issue. */
export default function NewWorkspaceFromDialog({
  open,
  onOpenChange,
  defaultProjectId,
}: NewWorkspaceFromDialogProps) {
  const navigate = useNavigate();
  const { projects, createWorkspace } = useProjects();
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [tab, setTab] = useState<SourceTab>("pulls");
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeProjectId = projectId ?? defaultProjectId ?? projects[0]?.id;
  const activeProject = projects.find((p) => p.id === activeProjectId);
  const { branches, pulls, issues } = useWorkspaceSources(activeProjectId, open);

  useEffect(() => {
    if (!open) return;
    setProjectId(undefined);
    setTab("pulls");
    setQuery("");
    setSelectedIndex(0);
  }, [open]);

  // Pasting a GitHub PR/issue URL jumps straight to the matching item.
  function handleQueryChange(value: string) {
    const prUrl = value.match(/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/);
    const issueUrl = value.match(/github\.com\/[^/\s]+\/[^/\s]+\/issues\/(\d+)/);
    if (prUrl) {
      setTab("pulls");
      setQuery(`#${prUrl[1]}`);
    } else if (issueUrl) {
      setTab("issues");
      setQuery(`#${issueUrl[1]}`);
    } else {
      setQuery(value);
    }
    setSelectedIndex(0);
  }

  const normalizedQuery = query.trim().replace(/^#/, "").toLowerCase();
  const numericQuery = /^\d+$/.test(normalizedQuery) ? Number(normalizedQuery) : null;

  const rows = useMemo<PickerRow[]>(() => {
    const matches = (...fields: Array<string | number | undefined>) =>
      !normalizedQuery ||
      fields.some((f) => f !== undefined && String(f).toLowerCase().includes(normalizedQuery));

    if (tab === "pulls") {
      const items = pulls.data?.pulls ?? [];
      const result: PickerRow[] = items
        .filter((p) => matches(p.number, p.title, p.branch, p.author))
        .map((p) => ({
          key: `pr-${p.number}`,
          icon: p.isDraft ? ("pr-draft" as const) : ("pr" as const),
          prefix: `#${p.number}`,
          label: p.title,
          // Checked-out PRs open their workspace: surface its name like the branches tab does.
          detail: p.workspaceId ? p.workspaceName : p.author,
          workspaceId: p.workspaceId,
          source: { kind: "pr", number: p.number },
        }));
      if (numericQuery !== null && !items.some((p) => p.number === numericQuery)) {
        result.push({
          key: `pr-manual-${numericQuery}`,
          icon: "pr",
          prefix: `#${numericQuery}`,
          label: `Pull request #${numericQuery}`,
          source: { kind: "pr", number: numericQuery },
        });
      }
      return result;
    }
    if (tab === "branches") {
      return (branches.data?.branches ?? [])
        .filter((b) => matches(b.name))
        .map((b) => ({
          key: `branch-${b.name}`,
          icon: "branch" as const,
          label: b.name,
          detail: b.workspaceName,
          workspaceId: b.workspaceId,
          source: { kind: "branch", branch: b.name },
        }));
    }
    const items = issues.data?.issues ?? [];
    const result: PickerRow[] = items
      .filter((i) => matches(i.number, i.title, i.author))
      .map((i) => ({
        key: `issue-${i.number}`,
        icon: "issue" as const,
        prefix: `#${i.number}`,
        label: i.title,
        detail: i.author,
        source: { kind: "issue", number: i.number },
      }));
    if (numericQuery !== null && !items.some((i) => i.number === numericQuery)) {
      result.push({
        key: `issue-manual-${numericQuery}`,
        icon: "issue",
        prefix: `#${numericQuery}`,
        label: `Issue #${numericQuery}`,
        source: { kind: "issue", number: numericQuery },
      });
    }
    return result;
  }, [tab, normalizedQuery, numericQuery, pulls.data, branches.data, issues.data]);

  const clampedIndex = Math.min(selectedIndex, Math.max(rows.length - 1, 0));

  async function activateRow(row: PickerRow) {
    if (row.workspaceId) {
      onOpenChange(false);
      navigate(`/workspaces/${row.workspaceId}`);
      return;
    }
    if (!row.source || !activeProjectId || creating) return;
    setCreating(true);
    try {
      const ws = await createWorkspace(activeProjectId, row.source);
      onOpenChange(false);
      navigate(`/workspaces/${ws.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create workspace");
    } finally {
      setCreating(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[clampedIndex];
      if (row) void activateRow(row);
    }
  }

  const activeQuery = tab === "pulls" ? pulls : tab === "branches" ? branches : issues;
  const embeddedError =
    tab === "pulls" ? pulls.data?.error : tab === "issues" ? issues.data?.error : undefined;
  const queryErrorMessage: Record<SourceTab, string> = {
    pulls: "Failed to load pull requests",
    branches: "Failed to load branches",
    issues: "Failed to load issues",
  };
  const sourceError =
    embeddedError ??
    (activeQuery.isError
      ? activeQuery.error instanceof Error && activeQuery.error.message
        ? activeQuery.error.message
        : queryErrorMessage[tab]
      : undefined);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[20%] translate-y-0 gap-0 bg-popover p-0 text-popover-foreground sm:max-w-2xl"
        showCloseButton={false}
        aria-describedby={undefined}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">New workspace from…</DialogTitle>
        <div className="flex items-center gap-2 border-b px-3">
          <SearchIcon className="size-4 shrink-0 opacity-50" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={SEARCH_PLACEHOLDER[tab]}
            className="h-12 w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
            disabled={creating}
          />
          {creating && <Spinner className="size-4 shrink-0" />}
        </div>
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="inline-flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  tab === id
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => {
                  setTab(id);
                  setSelectedIndex(0);
                  inputRef.current?.focus();
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {projects.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="xs" className="text-muted-foreground hover:text-foreground">
                  {activeProject?.name ?? "Select project"}
                  <ChevronDownIcon className="ml-0.5 size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[160px]">
                {projects.map((p) => (
                  <DropdownMenuItem
                    key={p.id}
                    onSelect={() => {
                      setProjectId(p.id);
                      setSelectedIndex(0);
                    }}
                  >
                    {p.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <div className="max-h-[min(420px,60vh)] overflow-y-auto p-1" role="listbox" aria-label="Workspace sources">
          {activeQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Loading…
            </div>
          ) : sourceError ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{sourceError}</div>
          ) : rows.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No results found.</div>
          ) : (
            rows.map((row, index) => {
              const selected = index === clampedIndex;
              return (
                <button
                  key={row.key}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm",
                    selected && "bg-accent text-accent-foreground",
                  )}
                  onMouseMove={() => setSelectedIndex(index)}
                  onClick={() => void activateRow(row)}
                  disabled={creating}
                >
                  <RowIcon icon={row.icon} />
                  {row.prefix && (
                    <span className="shrink-0 tabular-nums text-muted-foreground">{row.prefix}</span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{row.label}</span>
                  {row.detail && (
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">{row.detail}</span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
