import { useRef } from "react";
import { ArrowLeft, Paintbrush, Wifi } from "lucide-react";
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
      <div className="flex h-12 items-center border-b border-border/50 px-4">
        <button
          type="button"
          onClick={() => navigate(returnTo.current)}
          className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-sidebar-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to app
        </button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2">
          <div className="mb-4">
            <h3 className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Settings
            </h3>
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
          </div>

          <div>
            <h3 className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Repositories
            </h3>
            {projects.map((project) => {
              const color = getProjectColor(project.name);
              const isActive = pathname === `/settings/repositories/${project.id}`;
              return (
                <Link
                  key={project.id}
                  to={`/settings/repositories/${project.id}`}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-sidebar-accent/60",
                    isActive && "bg-sidebar-accent/60",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-bold",
                      color.bg,
                      color.text,
                    )}
                  >
                    {project.name[0]?.toUpperCase() ?? "?"}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{project.name}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

function NavItem({ to, label, icon, active }: { to: string; label: string; icon: React.ReactNode; active: boolean }) {
  return (
    <Link
      to={to}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-sidebar-accent/60",
        active && "bg-sidebar-accent/60",
      )}
    >
      {icon}
      {label}
    </Link>
  );
}
