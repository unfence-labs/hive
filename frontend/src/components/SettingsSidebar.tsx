import { useRef } from "react";
import { ArrowLeft, Paintbrush, Wifi, GitFork } from "lucide-react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { getProjectColor } from "@/lib/project-colors";
import type { Project } from "@/types";

interface SettingsSidebarProps {
  projects: Project[];
}

export default function SettingsSidebar({ projects }: SettingsSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { pathname } = location;
  const returnTo = useRef((location.state as { from?: string } | null)?.from ?? "/projects");

  return (
    <div className="flex h-full w-72 flex-col border-r border-border/50 bg-sidebar text-sidebar-foreground">
      <div
        className="shrink-0"
        style={{ height: "var(--titlebar-inset, 0px)" }}
        data-tauri-drag-region
      />

      <ScrollArea className="flex-1">
        <div className="px-3 py-3">
          <button
            type="button"
            onClick={() => navigate(returnTo.current)}
            className="mb-4 flex items-center gap-2 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>
          <SidebarSection label="General">
            <NavItem
              to="/settings/appearance"
              label="Appearance"
              icon={<Paintbrush className="h-4 w-4" />}
              active={pathname === "/settings/appearance"}
            />
            <NavItem
              to="/settings/connection"
              label="Connection"
              icon={<Wifi className="h-4 w-4" />}
              active={pathname === "/settings/connection"}
            />
          </SidebarSection>

          {projects.length > 0 && (
            <SidebarSection label="Repositories">
              {projects.map((project) => {
                const color = getProjectColor(project.name);
                const isActive = pathname === `/settings/repositories/${project.id}`;
                return (
                  <Link
                    key={project.id}
                    to={`/settings/repositories/${project.id}`}
                    className={cn(
                      "group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                      isActive
                        ? "bg-primary/10 text-sidebar-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold",
                        color.bg,
                        color.text,
                      )}
                    >
                      {project.name[0]?.toUpperCase() ?? "?"}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{project.name}</span>
                    {isActive && (
                      <GitFork className="h-3 w-3 shrink-0 text-primary/60" />
                    )}
                  </Link>
                );
              })}
            </SidebarSection>
          )}
        </div>
      </ScrollArea>
    </div>
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
