import { useRef, useState } from "react";
import {
  ArrowLeft,
  Bell,
  BookOpen,
  Bot,
  ChevronRight,
  CircleUser,
  FileText,
  Folder,
  FolderOpen,
  GitFork,
  Paintbrush,
  Sparkles,
  Wifi,
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
import type { Project } from "@/types";

export default function SettingsSidebar() {
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
    <div className="flex items-center justify-end px-2 py-1.5">
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
          <SidebarSection label="General">
            <NavItem
              to="/settings/appearance"
              label="Appearance"
              icon={<Paintbrush className="h-4 w-4" />}
              active={pathname === "/settings/appearance"}
            />
            <NavItem
              to="/settings/account"
              label="Account"
              icon={<CircleUser className="h-4 w-4" />}
              active={pathname === "/settings/account"}
            />
            <NavItem
              to="/settings/connection"
              label="Connection"
              icon={<Wifi className="h-4 w-4" />}
              active={pathname === "/settings/connection"}
            />
            <NavItem
              to="/settings/notifications"
              label="Notifications"
              icon={<Bell className="h-4 w-4" />}
              active={pathname === "/settings/notifications"}
            />
            <NavItem
              to="/settings/agents"
              label="Agents"
              icon={<Bot className="h-4 w-4" />}
              active={pathname === "/settings/agents"}
            />
            <NavItem
              to="/settings/instructions"
              label="Instructions"
              icon={<BookOpen className="h-4 w-4" />}
              active={pathname === "/settings/instructions"}
            />
            <NavItem
              to="/settings/prompt-templates"
              label="Prompts"
              icon={<FileText className="h-4 w-4" />}
              active={pathname === "/settings/prompt-templates"}
            />
            <NavItem
              to="/settings/skills"
              label="Skills"
              icon={<Sparkles className="h-4 w-4" />}
              active={pathname === "/settings/skills"}
            />
          </SidebarSection>

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
      />
      <span className="min-w-0 flex-1 truncate">{project.name}</span>
      {isActive && (
        <GitFork className="h-3 w-3 shrink-0 text-primary/60" />
      )}
    </Link>
  );
}

function NavItem({ to, label, icon, active }: { to: string; label: string; icon: React.ReactNode; active: boolean }) {
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
