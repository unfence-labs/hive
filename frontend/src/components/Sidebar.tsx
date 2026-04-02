import { useMemo, useState } from "react";
import { getNextRun, formatTimeUntil } from "@/lib/cron";
import { ArchiveIcon, FolderPlus, LayoutGrid, Loader2, Plus, Settings } from "lucide-react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkspaceLiveDataContext } from "@/contexts/WorkspaceLiveDataContext";
import { useProjects } from "@/hooks/useProjects";
import { useBulkPrStatus, usePrStatusMap } from "@/hooks/usePrStatus";
import { computePrDisplayCompact } from "@/lib/pr-display";
import { BranchLabel } from "@/components/BranchLabel";
import AgentActivityPreview from "@/components/chat/AgentActivityPreview";
import { ActivityWave } from "@/components/ui/activity-wave";
import { api } from "@/hooks/useApi";
import { cn } from "@/lib/utils";
import { ProjectAvatar } from "@/components/ProjectAvatar";
import { useAutomations } from "@/hooks/useAutomations";
import { SidebarShell } from "@/components/SidebarShell";
import type { Automation, DiffStatResponse } from "@/types";

// ── Helpers ──────────────────────────────────────────────────────────

/** Extract { owner, repo } from any git URL, or null if unparseable. */
export function parseProjectOwnerRepo(url: string): { owner: string; repo: string } | null {
  // SCP-style: git@host:owner/repo.git
  const scpMatch = url.match(/^[^@]+@[^:]+:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (scpMatch) return { owner: scpMatch[1], repo: scpMatch[2] };

  // URL-style: https://host/owner/repo.git or ssh://git@host/owner/repo
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length >= 2)
      return { owner: segments[0], repo: segments[1].replace(/\.git$/, "") };
  } catch {
    // not a valid URL
  }

  return null;
}

// ── Shared sidebar group header ──────────────────────────────────────

interface SidebarGroupHeaderProps {
  icon: React.ReactNode;
  label: React.ReactNode;
  badge?: React.ReactNode;
  count?: number;
  isLoading?: boolean;
  onAdd?: (e: React.MouseEvent) => void;
  addLabel?: string;
  variant?: "default" | "plain";
  buttonClassName?: string;
}

function SidebarGroupHeader({
  icon,
  label,
  badge,
  count,
  isLoading,
  onAdd,
  addLabel,
  variant = "default",
  buttonClassName,
}: SidebarGroupHeaderProps) {
  const isPlain = variant === "plain";

  return (
    <div className="group relative flex w-full items-center">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full min-w-0 items-center overflow-hidden text-left transition-colors",
            isPlain
              ? "gap-2 px-0 py-1"
              : "gap-2.5 rounded-md px-2.5 py-2.5 hover:bg-sidebar-accent/40",
            count !== undefined && "pr-8",
            buttonClassName,
          )}
        >
          {icon}
          <span className="min-w-0 flex-1 truncate text-xs font-semibold lowercase tracking-wider text-sidebar-foreground">
            {label}
          </span>
          {badge}
        </button>
      </CollapsibleTrigger>
      {count !== undefined && (
        <div className={cn("absolute inset-y-0 flex items-center", isPlain ? "right-0" : "right-2.5")}>
          <div className="relative flex h-5 w-5 items-center justify-center">
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : (
              <>
                <span className="text-xs tabular-nums text-muted-foreground/60 transition-opacity group-hover:opacity-0">
                  {count}
                </span>
                {onAdd && (
                  <button
                    type="button"
                    className="absolute inset-0 flex items-center justify-center text-muted-foreground opacity-0 transition-opacity hover:text-sidebar-foreground group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAdd(e);
                    }}
                    aria-label={addLabel}
                    title={addLabel}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface SidebarSectionHeaderProps {
  label: string;
  isLoading?: boolean;
  onAdd?: () => void;
  addLabel?: string;
  className?: string;
}

function SidebarSectionHeader({
  label,
  isLoading = false,
  onAdd,
  addLabel,
  className,
}: SidebarSectionHeaderProps) {
  return (
    <div className={cn("group relative flex w-full items-center", className)}>
      <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      <div className="relative flex h-5 w-5 items-center justify-center">
        {isLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : onAdd ? (
          <button
            type="button"
            className="flex items-center justify-center text-primary transition-colors hover:text-primary/80"
            onClick={onAdd}
            aria-label={addLabel}
            title={addLabel}
          >
            <Plus className="h-4 w-4" />
          </button>
        ) : null
        }
      </div>
    </div>
  );
}

// ── Sidebar ──────────────────────────────────────────────────────────

interface SidebarProps {
  onAddProject: () => void;
  onAddAutomation?: () => void;
}

export default function Sidebar({ onAddProject, onAddAutomation }: SidebarProps) {
  const { projects, loading, createWorkspace, archiveWorkspace } = useProjects();
  const { data: automations, isLoading: automationsLoading } = useAutomations();
  const queryClient = useQueryClient();
  const { wsId: activeWsId } = useParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [creatingProjectId, setCreatingProjectId] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<string | null>(null);
  const [archivingWsId, setArchivingWsId] = useState<string | null>(null);
  const liveData = useWorkspaceLiveDataContext();

  const activeProjectId = projects.find((project) =>
    (project.workspaces ?? []).some((workspace) => workspace.id === activeWsId),
  )?.id;

  const allWsIds = useMemo(
    () => projects.flatMap((p) => (p.workspaces ?? []).map((ws) => ws.id)),
    [projects],
  );
  const { loading: prLoading } = useBulkPrStatus(allWsIds);
  const prStatuses = usePrStatusMap(allWsIds);
  const sortedAutomations = useMemo(() => {
    if (!automations) return [];
    return [...automations].sort((a, b) => automationSortKey(a) - automationSortKey(b));
  }, [automations]);

  const isProjectExpanded = (projectId: string) => {
    const expanded = expandedProjects[projectId];
    if (typeof expanded === "boolean") return expanded;
    return activeProjectId === projectId;
  };

  const handleAddWorkspace = async (projectId: string) => {
    if (creatingProjectId) return;
    setCreatingProjectId(projectId);
    try {
      const workspace = await createWorkspace(projectId);
      setExpandedProjects((prev) => ({ ...prev, [projectId]: true }));
      navigate(`/workspaces/${workspace.id}`);
    } finally {
      setCreatingProjectId(null);
    }
  };

  const handleArchiveClick = async (wsId: string) => {
    let uncommittedCount = liveData[wsId]?.diffStats?.uncommitted?.length;
    if (uncommittedCount === undefined) {
      try {
        const stats = await queryClient.fetchQuery({
          queryKey: ["diff-stat", wsId],
          queryFn: () => api.get<DiffStatResponse>(`/api/workspaces/${wsId}/diff/stat`),
        });
        uncommittedCount = stats.uncommitted.length;
      } catch {
        uncommittedCount = 0;
      }
    }
    if (uncommittedCount > 0) {
      setArchiveTarget(wsId);
    } else {
      await doArchive(wsId);
    }
  };

  const doArchive = async (wsId: string) => {
    setArchivingWsId(wsId);
    try {
      const wasActive = activeWsId === wsId;
      await archiveWorkspace(wsId);
      if (wasActive) navigate("/home");
    } finally {
      setArchivingWsId(null);
    }
  };

  const headerActions = (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to="/mosaic"
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-sidebar-foreground"
            aria-label="Mosaic View"
          >
            <LayoutGrid className="h-4 w-4" />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="bottom">Mosaic View</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  const footerActions = (
    <div className="flex items-center justify-end gap-1 px-2 py-1.5">
      <Link
        to="/settings"
        state={{ from: pathname }}
        className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-sidebar-foreground"
        aria-label="Settings"
        title="Settings"
      >
        <Settings className="h-4 w-4" />
      </Link>
    </div>
  );

  return (
    <SidebarShell footerActions={footerActions} headerActions={headerActions}>
      <ScrollArea className="flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!min-w-full [&_[data-slot=scroll-area-viewport]>div]:!w-full">
        <div className="p-2">
          {loading ? (
            <div className="space-y-2 px-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-6 w-full" />
            </div>
          ) : (
            <TooltipProvider delayDuration={400}>
              <SidebarSectionHeader
                label="Workspaces"
                className="mb-2"
              />

              {projects.map((project, index) => {
                const parsed = parseProjectOwnerRepo(project.url);
                const displayLabel = parsed ? (
                  <><span className="text-muted-foreground">{parsed.owner}/</span>{parsed.repo}</>
                ) : project.name;
                const displayLabelPlain = parsed ? `${parsed.owner}/${parsed.repo}` : project.name;
                return (
                <div
                  key={project.id}
                  className={cn(index > 0 && "mt-3")}
                >
                  <Collapsible
                    open={isProjectExpanded(project.id)}
                    onOpenChange={(open) =>
                      setExpandedProjects((prev) => ({ ...prev, [project.id]: open }))
                    }
                  >
                    <SidebarGroupHeader
                      icon={
                        <ProjectAvatar
                          name={project.name}
                          projectId={project.id}
                          hasFavicon={project.hasFavicon}
                          className="h-[18px] w-[18px]"
                        />
                      }
                      label={displayLabel}
                      count={(project.workspaces ?? []).length}
                      isLoading={creatingProjectId === project.id}
                      onAdd={() => { void handleAddWorkspace(project.id); }}
                      addLabel={`Add workspace to ${displayLabelPlain}`}
                      variant="plain"
                    />

                    <CollapsibleContent>
                      <div className="mt-1 space-y-1.5">
                        {(project.workspaces ?? []).map((ws) => {
                          const wsLive = liveData[ws.id];
                          const wsStreaming = wsLive?.streaming ?? false;
                          const wsScriptRunning = wsLive?.scriptRunning ?? false;
                          const displayBranch = wsLive?.branch ?? ws.branch;
                          const wsUnread = !wsStreaming && Object.keys(wsLive?.unreadSessions ?? {}).length > 0;
                          const prStatus = prStatuses[ws.id];
                          const wsArchiving = archivingWsId === ws.id;

                          return (
                            <div key={ws.id} className={cn("group/ws relative transition-opacity", wsArchiving && "pointer-events-none opacity-40")}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Link
                                    to={`/workspaces/${ws.id}`}
                                    className={cn(
                                      "sidebar-card block rounded-md border py-1.5 pl-2 pr-2",
                                      activeWsId === ws.id && "sidebar-card-active",
                                    )}
                                  >
                                    <div className="flex items-center gap-1.5">
                                      <div className="flex h-3.5 w-3.5 shrink-0 items-center justify-center overflow-visible">
                                        {wsStreaming ? (
                                          <AgentActivityPreview size="small" />
                                        ) : wsUnread ? (
                                          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                                        ) : null}
                                      </div>
                                      <BranchLabel
                                        branch={displayBranch}
                                        showIcon={false}
                                        className={cn(
                                          "min-w-0 flex-1 text-sm",
                                          activeWsId === ws.id || wsUnread
                                            ? "text-sidebar-foreground"
                                            : "text-muted-foreground",
                                        )}
                                      />
                                      {wsScriptRunning && (
                                        <ActivityWave size="small" decorative className="shrink-0" />
                                      )}
                                    </div>

                                    <div className="mt-0.5 flex items-center gap-1 pl-5 text-[11px]">
                                      {prStatus?.pr ? (
                                        (() => {
                                          const display = computePrDisplayCompact(prStatus.pr);
                                          return (
                                            <span className={cn("truncate", display.textClass)}>
                                              #{prStatus.pr.number} {display.label}
                                            </span>
                                          );
                                        })()
                                      ) : prLoading ? (
                                        <span className="text-muted-foreground">Loading…</span>
                                      ) : prStatus?.error ? (
                                        <span className="text-muted-foreground">Error fetching PR</span>
                                      ) : (
                                        <span className="text-muted-foreground">No PR</span>
                                      )}
                                    </div>
                                  </Link>
                                </TooltipTrigger>
                                <TooltipContent side="right" className="text-xs">
                                  {ws.name}
                                </TooltipContent>
                              </Tooltip>

                              {wsArchiving ? (
                                <div className="absolute right-1.5 top-1.5 p-0.5">
                                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                                </div>
                              ) : !wsScriptRunning && (
                                <button
                                  type="button"
                                  className="absolute right-1.5 top-1.5 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-sidebar-foreground group-hover/ws:opacity-100"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    void handleArchiveClick(ws.id);
                                  }}
                                  aria-label={`Archive workspace ${ws.name}`}
                                  title="Archive workspace"
                                >
                                  <ArchiveIcon className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
                );
              })}

              <div className="mt-6">
                <div className="mb-6 border-t border-white/15" />
                <SidebarSectionHeader
                  label="Automations"
                  isLoading={automationsLoading}
                  onAdd={onAddAutomation}
                  addLabel="Add automation"
                />

                {automationsLoading ? (
                  <div className="mt-2 space-y-1.5">
                    <Skeleton className="h-12 w-full rounded-md" />
                    <Skeleton className="h-12 w-full rounded-md" />
                  </div>
                ) : sortedAutomations.length === 0 ? (
                  <div className="mt-2 py-1">
                    <p className="text-xs text-muted-foreground/60">no automations</p>
                  </div>
                ) : (
                  <div className="mt-2 space-y-1.5">
                    {sortedAutomations.map((auto) => (
                      <AutomationRow key={auto.id} auto={auto} pathname={pathname} />
                    ))}
                  </div>
                )}
              </div>
            </TooltipProvider>
          )}
        </div>
      </ScrollArea>

      {/* ── Bottom action ─────────────────────────────────────────── */}
      <div className="shrink-0 px-2 pb-1.5">
        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-primary/40 px-2 py-2 text-sm text-primary transition-colors hover:border-primary hover:bg-primary/10"
          onClick={onAddProject}
        >
          <FolderPlus className="h-4 w-4 shrink-0" />
          Add repository
        </button>
      </div>

      <AlertDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive workspace</AlertDialogTitle>
            <AlertDialogDescription>
              This workspace has uncommitted changes that will be lost. Are you sure you want to archive it?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (archiveTarget) void doArchive(archiveTarget);
                setArchiveTarget(null);
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </SidebarShell>
  );
}

// ── Automation sidebar list ──────────────────────────────────────────

export function automationSortKey(a: Automation): number {
  if (a.lastRunStatus === "running") return 0;
  if (a.enabled) return 1;
  return 2;
}

export function describeSchedule(expression: string): string {
  const presets: Record<string, string> = {
    "0 * * * *": "Hourly",
    "0 */6 * * *": "Every 6h",
    "0 2 * * *": "Daily 2am",
    "0 8 * * *": "Daily 8am",
    "0 0 * * *": "Daily midnight",
    "0 9 * * 1-5": "Weekdays 9am",
    "0 9 * * 1": "Weekly Mon",
  };
  return presets[expression] ?? expression;
}

function AutomationRow({ auto, pathname }: { auto: Automation; pathname: string }) {
  const isActive = pathname === `/automations/${auto.id}`;
  const isRunning = auto.lastRunStatus === "running";
  const rightLabel = (() => {
    if (!auto.enabled) return "disabled";
    if (isRunning) return "running";
    if (auto.trigger.type === "cron") {
      const next = getNextRun(auto.trigger.expression);
      if (!next) return describeSchedule(auto.trigger.expression);
      const diffMs = next.getTime() - Date.now();
      if (diffMs < 0) return "due now";
      return formatTimeUntil(diffMs);
    }
    return "";
  })();

  return (
    <Link
      to={`/automations/${auto.id}`}
      className={cn(
        "sidebar-card block rounded-md border px-2.5 py-1.5",
        isActive && "sidebar-card-active",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            isRunning
              ? "bg-green-500 animate-pulse"
              : auto.enabled
                ? "bg-green-500"
                : "bg-muted-foreground/40",
          )}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm",
            isActive || auto.enabled
              ? "text-sidebar-foreground"
              : "text-muted-foreground",
          )}
        >
          {auto.name}
        </span>
        <span
          className={cn(
            "shrink-0 text-[11px]",
            isActive ? "text-sidebar-foreground/70" : "text-muted-foreground",
          )}
        >
          {rightLabel}
        </span>
      </div>
    </Link>
  );
}
