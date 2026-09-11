import { useRef, useState } from "react";
import {
  ArrowLeft,
  Bell,
  BookOpen,
  Bot,
  ChevronRight,
  CircleUser,
  Cpu,
  Download,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  GitFork,
  Paintbrush,
  Server,
  Sparkles,
  Users,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { ProjectAvatar } from "@/components/ProjectAvatar";
import { useProjects } from "@/hooks/useProjects";
import {
  useReadonlySidebarProjectFolders,
  type SidebarProjectFolderView,
} from "@/hooks/useSidebarProjectFolders";
import { SidebarShell } from "@/components/SidebarShell";
import { SidebarRecoveryControl } from "@/components/SidebarRecoveryControl";
import { isDesktopShell } from "@/lib/is-desktop";
import type { Project } from "@/types";

export default function SettingsSidebar({ isResyncing = false }: { isResyncing?: boolean }) {
  const { projects, ready: projectsReady } = useProjects();
  const navigate = useNavigate();
  const location = useLocation();
  const { pathname } = location;
  const returnTo = useRef((location.state as { from?: string } | null)?.from ?? "/home");
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const { folders, rootProjects } = useReadonlySidebarProjectFolders(projects, projectsReady);
  const visibleFolders = folders.filter((folder) => folder.projects.length > 0);

  const isFolderExpanded = (folderId: string) => expandedFolders[folderId] ?? false;
  const toggleFolder = (folderId: string) => {
    setExpandedFolders((prev) => ({
      ...prev,
      [folderId]: !(prev[folderId] ?? false),
    }));
  };

  const footerActions = (
    <div className="flex items-center justify-between px-2 py-1.5">
      <SidebarRecoveryControl isResyncing={isResyncing} />
      <button
        type="button"
        onClick={() => navigate(returnTo.current)}
        className="flex items-center gap-2 rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/40 hover:text-sidebar-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        Back
      </button>
    </div>
  );

  return (
    <SidebarShell footerActions={footerActions}>
      <ScrollArea className="flex-1">
        <div className="px-3 py-3">
          <SettingsNavigation />

          {projects.length > 0 && (
            <SidebarSection label="Repositories">
              {visibleFolders.map((folder) => (
                <SettingsRepositoryFolder
                  key={folder.id}
                  folder={folder}
                  pathname={pathname}
                  expanded={isFolderExpanded(folder.id)}
                  onToggle={() => toggleFolder(folder.id)}
                />
              ))}
              {rootProjects.map((project) => (
                <RepositoryNavItem
                  key={project.id}
                  project={project}
                  pathname={pathname}
                />
              ))}
            </SidebarSection>
          )}
        </div>
      </ScrollArea>
    </SidebarShell>
  );
}

export function UpdateSidebar({
  connectionAvailable,
}: {
  connectionAvailable: boolean;
}) {
  return (
    <SidebarShell footerActions={null} showServerStatus={false}>
      <ScrollArea className="flex-1">
        <div className="px-3 py-3">
          <SettingsNavigation restricted={{ connectionAvailable }} />
        </div>
      </ScrollArea>
    </SidebarShell>
  );
}

interface NavEntry {
  to: string;
  label: string;
  icon: LucideIcon;
  desktopOnly?: boolean;
}

/**
 * The settings destinations, in sidebar order. Declared once: the restricted
 * shell shown by the compatibility gate renders the very same list, only with
 * everything it cannot reach turned off.
 */
const GENERAL_NAV: NavEntry[] = [
  { to: "/settings/appearance", label: "Appearance", icon: Paintbrush },
  { to: "/settings/account", label: "Account", icon: CircleUser },
  { to: "/settings/connection", label: "Connection", icon: Wifi },
  { to: "/settings/server", label: "Server", icon: Server, desktopOnly: true },
  { to: "/settings/notifications", label: "Notifications", icon: Bell },
  { to: "/settings/updates", label: "Updates", icon: Download },
];

const AGENTS_NAV: NavEntry[] = [
  { to: "/settings/cli", label: "Harness", icon: Bot },
  { to: "/settings/models", label: "Models", icon: Cpu },
  { to: "/settings/instructions", label: "Instructions", icon: BookOpen },
  { to: "/settings/prompt", label: "Prompt", icon: FileText },
  { to: "/settings/skills", label: "Skills", icon: Sparkles },
  { to: "/settings/team", label: "Team", icon: Users },
  { to: "/settings/subagents", label: "Subagents", icon: FileCode2 },
];

function SettingsNavigation({
  restricted,
}: {
  /** Set by the compatibility gate: only Updates, and maybe Connection, work. */
  restricted?: { connectionAvailable: boolean };
}) {
  const { pathname } = useLocation();
  const isReachable = (to: string) => {
    if (!restricted) return true;
    if (to === "/settings/updates") return true;
    return to === "/settings/connection" && restricted.connectionAvailable;
  };
  // The gate routes everything but Connection to the update screen, so Updates
  // is what the user is looking at whenever Connection is not.
  const isActive = (to: string) =>
    restricted && to === "/settings/updates"
      ? pathname !== "/settings/connection" || !restricted.connectionAvailable
      : pathname === to;
  const items = (entries: NavEntry[]) =>
    entries
      .filter((entry) => !entry.desktopOnly || isDesktopShell())
      .map((entry) => (
        <NavItem
          key={entry.to}
          to={entry.to}
          label={entry.label}
          icon={<entry.icon className="h-4 w-4" />}
          active={isActive(entry.to)}
          disabled={!isReachable(entry.to)}
        />
      ));
  return (
    <>
      <SidebarSection label="General">{items(GENERAL_NAV)}</SidebarSection>
      <SidebarSection label="Agents">{items(AGENTS_NAV)}</SidebarSection>
    </>
  );
}

function SidebarSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h3 className="mb-1.5 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
        {label}
      </h3>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function SettingsRepositoryFolder({
  folder,
  pathname,
  expanded,
  onToggle,
}: {
  folder: SidebarProjectFolderView;
  pathname: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const containsActiveProject = folder.projects.some(
    (project) => pathname === `/settings/repositories/${project.id}`,
  );

  return (
    <div className="space-y-0.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-sm transition-colors hover:bg-sidebar-accent/40",
          containsActiveProject ? "text-sidebar-foreground" : "text-muted-foreground",
        )}
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform",
            expanded && "rotate-90",
          )}
        />
        {expanded ? (
          <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
          {folder.name}
        </span>
      </button>

      {expanded && (
        <div className="ml-2 border-l border-sidebar-border/40 pl-2">
          {folder.projects.map((project) => (
            <RepositoryNavItem
              key={project.id}
              project={project}
              pathname={pathname}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RepositoryNavItem({
  project,
  pathname,
}: {
  project: Project;
  pathname: string;
}) {
  const isActive = pathname === `/settings/repositories/${project.id}`;

  return (
    <Link
      to={`/settings/repositories/${project.id}`}
      className={cn(
        "group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
        isActive
          ? "bg-primary/10 text-sidebar-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
      )}
    >
      <ProjectAvatar
        name={project.name}
        projectId={project.id}
        hasFavicon={project.hasFavicon}
        faviconVersion={project.faviconVersion}
      />
      <span className="min-w-0 flex-1 truncate">{project.name}</span>
      {isActive && (
        <GitFork className="h-3 w-3 shrink-0 text-primary/60" />
      )}
    </Link>
  );
}

function NavItem({
  to,
  label,
  icon,
  active,
  disabled = false,
}: {
  to: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <span
        aria-disabled="true"
        className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground opacity-50"
      >
        {icon}
        {label}
      </span>
    );
  }
  return (
    <Link
      to={to}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
        active
          ? "bg-primary/10 text-sidebar-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
      )}
    >
      {icon}
      {label}
    </Link>
  );
}
