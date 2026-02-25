import { useEffect } from "react";
import { Outlet, useLocation, useOutletContext } from "react-router-dom";
import { PanelLeft } from "lucide-react";
import Sidebar from "./Sidebar";
import SettingsSidebar from "./SettingsSidebar";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import { useSidebarCollapsed, toggleSidebar } from "@/hooks/useSidebarCollapsed";
import { cn } from "@/lib/utils";

export interface LayoutContext {
  collapsed: boolean;
  toggle: () => void;
}

export function useLayoutContext() {
  return useOutletContext<LayoutContext>();
}

export function SettingsHeader({ children }: { children: React.ReactNode }) {
  const ctx = useOutletContext<LayoutContext | null>();
  return (
    <div className="flex h-12 shrink-0 items-center border-b border-border/50 px-4" data-tauri-drag-region>
      {ctx?.collapsed && (
        <button
          type="button"
          onClick={ctx.toggle}
          className="mr-2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Show sidebar"
          title="Show sidebar (⌘B)"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
      )}
      {children}
    </div>
  );
}

interface AppLayoutProps {
  onAddProject: () => void;
}

export default function AppLayout({ onAddProject }: AppLayoutProps) {
  const { pathname } = useLocation();
  const isSettings = pathname.startsWith("/settings");
  const { backendEnv } = useConnectionStatus();
  const { collapsed, toggle } = useSidebarCollapsed();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        if ((e.target as HTMLElement).isContentEditable) return;
        e.preventDefault();
        toggleSidebar();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="flex h-screen flex-col">
      {import.meta.env.DEV && (
        <div className="shrink-0 bg-amber-500/90 px-3 py-0.5 text-center text-xs font-medium text-black">
          Dev frontend → {backendEnv ? `${backendEnv} backend` : "connecting…"}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div
          className={cn(
            "shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out",
            collapsed ? "w-0" : "w-72",
          )}
        >
          {isSettings ? (
            <SettingsSidebar onCollapse={toggle} />
          ) : (
            <Sidebar onAddProject={onAddProject} onCollapse={toggle} />
          )}
        </div>
        <main className="relative flex flex-1 flex-col overflow-hidden">
          {collapsed && (
            <div
              className="absolute inset-x-0 top-0"
              style={{ height: "var(--titlebar-inset, 0px)" }}
              data-tauri-drag-region
            />
          )}
          {collapsed && !isSettings && (
            <button
              type="button"
              onClick={toggle}
              className="absolute left-2.5 z-30 flex items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              style={{ top: "calc(var(--titlebar-inset, 0px) + 0.75rem)" }}
              aria-label="Show sidebar"
              title="Show sidebar (⌘B)"
            >
              <PanelLeft className="h-4 w-4" />
            </button>
          )}
          <div
            className="relative min-h-0 flex-1 overflow-hidden"
            style={collapsed ? { paddingTop: "var(--titlebar-inset, 0px)" } : undefined}
          >
            <Outlet context={{ collapsed, toggle } satisfies LayoutContext} />
          </div>
        </main>
      </div>
    </div>
  );
}
