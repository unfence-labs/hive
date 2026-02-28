import { useMemo, useState } from "react";
import { ArchiveIcon, Clock, FolderPlus, Github, Loader2, Plus, Settings } from "lucide-react";
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
import { useBulkPrStatus } from "@/hooks/usePrStatus";
import { computePrDisplayCompact } from "@/lib/pr-display";
import { BranchLabel } from "@/components/BranchLabel";
import AgentActivityPreview from "@/components/chat/AgentActivityPreview";
import { WaveIndicator } from "@/components/WaveIndicator";
import { api } from "@/hooks/useApi";
import { cn } from "@/lib/utils";
import { ProjectAvatar } from "@/components/ProjectAvatar";
import { useAutomations } from "@/hooks/useAutomations";
import type { Automation, DiffStatResponse } from "@/types";

// ── Helpers ──────────────────────────────────────────────────────────

/** Extract { owner, repo } from any git URL, or null if unparseable. */
function parseProjectOwnerRepo(url: string): { owner: string; repo: string } | null {
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
  onAdd?: (e: React.MouseEvent) => void;
  addLabel?: string;
  addContent?: React.ReactNode;
}

function SidebarGroupHeader({
  icon,
  label,
  badge,
  count,
  onAdd,
  addLabel,
  addContent,
}: SidebarGroupHeaderProps) {
  return (
    <div className="group relative flex w-full items-center">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full min-w-0 items-center gap-2.5 overflow-hidden rounded-md bg-[#1e1e28] px-2.5 py-2 text-left transition-colors hover:bg-[#252532]"
        >
          {icon}
          <span className="min-w-0 flex-1 truncate text-xs font-semibold lowercase tracking-wider text-sidebar-foreground">
            {label}
          </span>
          {badge}
        </button>
      </CollapsibleTrigger>
      {count !== undefined && (
        <div className="absolute inset-y-0 right-2.5 flex items-center">
          <div className="relative flex h-5 w-5 items-center justify-center">
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
                {addContent ?? <Plus className="h-4 w-4" />}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sidebar ──────────────────────────────────────────────────────────

interface SidebarProps {
  onAddProject: () => void;
  onAddAutomation?: () => void;
}

type SidebarTab = "build" | "automation";

export default function Sidebar({ onAddProject, onAddAutomation }: SidebarProps) {
  const { projects, loading, createWorkspace, archiveWorkspace } = useProjects();
  const queryClient = useQueryClient();
  const { wsId: activeWsId } = useParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [creatingProjectId, setCreatingProjectId] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<string | null>(null);
  const liveData = useWorkspaceLiveDataContext();

  // Derive active tab from route
  const activeTab: SidebarTab = pathname.startsWith("/automations") ? "automation" : "build";

  const handleTabClick = (tab: SidebarTab) => {
    if (tab === activeTab) return;
    if (tab === "automation") {
      navigate("/automations");
    } else {
      navigate("/projects");
    }
  };

  const activeProjectId = projects.find((project) =>
    (project.workspaces ?? []).some((workspace) => workspace.id === activeWsId),
  )?.id;

  const allWsIds = useMemo(
    () => projects.flatMap((p) => (p.workspaces ?? []).map((ws) => ws.id)),
    [projects],
  );
  const { results: prStatuses, loading: prLoading } = useBulkPrStatus(allWsIds);

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
    const wasActive = activeWsId === wsId;
    await archiveWorkspace(wsId);
    if (wasActive) navigate("/projects");
  };

  return (
    <div className="flex h-full w-72 flex-col border-r border-border/50 bg-sidebar text-sidebar-foreground">
      <div
        className="shrink-0"
        style={{ height: "max(var(--titlebar-inset, 0px), 3rem)" }}
        data-tauri-drag-region
      />

      {/* ── Tab content ─────────────────────────────────────────────── */}
      {activeTab === "build" ? (
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
                {projects.map((project, index) => {
                  const parsed = parseProjectOwnerRepo(project.url);
                  const displayLabel = parsed ? (
                    <><span className="text-muted-foreground">{parsed.owner}/</span>{parsed.repo}</>
                  ) : project.name;
                  const displayLabelPlain = parsed ? `${parsed.owner}/${parsed.repo}` : project.name;
                  return (
                  <div
                    key={project.id}
                    className={cn(index > 0 && "mt-2.5")}
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
                            className="h-5 w-5"
                          />
                        }
                        label={displayLabel}
                        count={(project.workspaces ?? []).length}
                        onAdd={() => { void handleAddWorkspace(project.id); }}
                        addLabel={`Add workspace to ${displayLabelPlain}`}
                        addContent={creatingProjectId === project.id ? "..." : <Plus className="h-4 w-4" />}
                      />

                      <CollapsibleContent>
                        <div className="mt-1 space-y-0.5">
                          {(project.workspaces ?? []).map((ws) => {
                            const wsLive = liveData[ws.id];
                            const wsStreaming = wsLive?.streaming ?? false;
                            const wsScriptRunning = wsLive?.scriptRunning ?? false;
                            const displayBranch = wsLive?.branch ?? ws.branch;
                            const wsUnread = !wsStreaming && Object.keys(wsLive?.unreadSessions ?? {}).length > 0;
                            const prStatus = prStatuses[ws.id];

                            return (
                              <div key={ws.id} className="group/ws relative">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Link
                                      to={`/workspaces/${ws.id}`}
                                      className={cn(
                                        "block rounded-md py-1.5 pl-2 pr-2 transition-colors hover:bg-sidebar-accent/60",
                                        activeWsId === ws.id
                                          ? "border-2 border-dashed border-primary/50"
                                          : "border-2 border-transparent",
                                      )}
                                    >
                                      <div className="flex items-center gap-1.5">
                                        {wsStreaming ? (
                                          <div className="flex h-3.5 w-3.5 shrink-0 items-center justify-center overflow-visible">
                                            <AgentActivityPreview size="small" />
                                          </div>
                                        ) : wsUnread ? (
                                          <div className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                                            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                                          </div>
                                        ) : null}
                                        <BranchLabel branch={displayBranch} showIcon={!wsStreaming && !wsUnread} className="min-w-0 flex-1 text-sm" />
                                        {wsScriptRunning && (
                                          <WaveIndicator className="shrink-0" />
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

                                {!wsScriptRunning && (
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
              </TooltipProvider>
            )}

          </div>
        </ScrollArea>
      ) : (
        <AutomationList onAddAutomation={onAddAutomation} />
      )}

      {/* ── Bottom action ─────────────────────────────────────────── */}
      <div className="shrink-0 px-2 pb-1.5">
        {activeTab === "build" ? (
          <button
            type="button"
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-primary/40 px-2 py-2 text-sm text-primary transition-colors hover:border-primary hover:bg-primary/10"
            onClick={onAddProject}
          >
            <FolderPlus className="h-4 w-4 shrink-0" />
            Add repository
          </button>
        ) : (
          <button
            type="button"
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-primary/40 px-2 py-2 text-sm text-primary transition-colors hover:border-primary hover:bg-primary/10"
            onClick={onAddAutomation}
          >
            <Plus className="h-4 w-4 shrink-0" />
            New automation
          </button>
        )}
      </div>

      {/* ── Footer: tabs + settings ─────────────────────────────────── */}
      <div className="flex items-center border-t border-border/50 px-2 py-1.5">
        <div className="flex flex-1 gap-0.5">
          {(["build", "automation"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => handleTabClick(tab)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                activeTab === tab
                  ? "bg-sidebar-accent text-sidebar-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/40 hover:text-sidebar-foreground",
              )}
            >
              {tab === "build" ? "Build" : "Automation"}
            </button>
          ))}
        </div>
        <Link
          to="/settings"
          state={{ from: pathname }}
          className="rounded p-1 text-muted-foreground transition-colors hover:text-sidebar-foreground"
          aria-label="Settings"
          title="Settings"
        >
          <Settings className="h-4 w-4" />
        </Link>
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

    </div>
  );
}

// ── Automation sidebar list ──────────────────────────────────────────

function automationSortKey(a: Automation): number {
  if (a.lastRunStatus === "running") return 0;
  if (a.enabled) return 1;
  return 2;
}

function describeSchedule(expression: string): string {
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

function AutomationList({ onAddAutomation }: { onAddAutomation?: () => void }) {
  const { data: automations, isLoading } = useAutomations();
  const { pathname } = useLocation();
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({ cron: true, github: true });

  const cronAutomations = useMemo(() => {
    if (!automations) return [];
    return [...automations]
      .filter((a) => a.trigger.type === "cron")
      .sort((a, b) => automationSortKey(a) - automationSortKey(b));
  }, [automations]);

  if (isLoading) {
    return (
      <ScrollArea className="flex-1">
        <div className="space-y-2 p-2 px-4">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-3/4" />
        </div>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className="flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!min-w-full [&_[data-slot=scroll-area-viewport]>div]:!w-full">
      <div className="space-y-2.5 p-2">
        {/* ── Cron group ──────────────────────────────────────────── */}
        <Collapsible
          open={expandedGroups.cron}
          onOpenChange={(open) => setExpandedGroups((prev) => ({ ...prev, cron: open }))}
        >
          <SidebarGroupHeader
            icon={<Clock className="h-5 w-5 shrink-0 text-muted-foreground" />}
            label="Cron"
            count={cronAutomations.length}
            onAdd={() => onAddAutomation?.()}
            addLabel="Add cron automation"
          />

          <CollapsibleContent>
            <div className="mt-1 space-y-0.5">
              {cronAutomations.length === 0 ? (
                <div className="px-2.5 py-3 text-center">
                  <p className="text-xs text-muted-foreground/60">No cron automations</p>
                  {onAddAutomation && (
                    <button
                      type="button"
                      className="mt-1 text-xs text-primary hover:underline"
                      onClick={onAddAutomation}
                    >
                      Create one
                    </button>
                  )}
                </div>
              ) : (
                cronAutomations.map((auto) => (
                  <AutomationRow key={auto.id} auto={auto} pathname={pathname} />
                ))
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* ── GitHub group ────────────────────────────────────────── */}
        <Collapsible
          open={expandedGroups.github}
          onOpenChange={(open) => setExpandedGroups((prev) => ({ ...prev, github: open }))}
        >
          <SidebarGroupHeader
            icon={<Github className="h-5 w-5 shrink-0 text-muted-foreground" />}
            label="GitHub"
            badge={
              <span className="rounded bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground/60">
                soon
              </span>
            }
          />

          <CollapsibleContent>
            <div className="px-2.5 py-3 text-center">
              <p className="text-xs text-muted-foreground/60">
                GitHub event triggers coming soon
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </ScrollArea>
  );
}

function AutomationRow({ auto, pathname }: { auto: Automation; pathname: string }) {
  const isActive = pathname === `/automations/${auto.id}`;
  const isRunning = auto.lastRunStatus === "running";

  return (
    <Link
      to={`/automations/${auto.id}`}
      className={cn(
        "block rounded-md px-2.5 py-1.5 transition-colors hover:bg-sidebar-accent/60",
        isActive
          ? "border-2 border-dashed border-primary/50"
          : "border-2 border-transparent",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            isRunning
              ? "bg-blue-500 animate-pulse"
              : auto.enabled
                ? "bg-emerald-500"
                : "bg-muted-foreground/40",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-sm text-sidebar-foreground">
          {auto.name}
        </span>
        {isRunning && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-blue-400" />}
      </div>
      <div className="mt-0.5 pl-4 text-[11px] text-muted-foreground">
        {auto.enabled ? describeSchedule(auto.trigger.expression) : "Disabled"}
      </div>
    </Link>
  );
}
