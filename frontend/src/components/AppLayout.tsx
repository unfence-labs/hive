import { useEffect } from "react";
import { Outlet, useLocation, useOutletContext } from "react-router-dom";
import { PanelLeft, PanelLeftClose } from "lucide-react";
import Sidebar from "./Sidebar";
import SettingsSidebar from "./SettingsSidebar";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import { useSidebarCollapsed } from "@/hooks/useSidebarCollapsed";

export interface LayoutContext {
  collapsed: boolean;
  toggleSidebar: () => void;
}

const defaultContext: LayoutContext = { collapsed: false, toggleSidebar: () => {} };

export function useLayoutContext(): LayoutContext {
  const ctx = useOutletContext() as LayoutContext | undefined;
  return ctx ?? defaultContext;
}

export function SettingsHeader({ children }: { children: React.ReactNode }) {
  const { collapsed } = useLayoutContext();
  return (
    <div
      className="flex h-12 shrink-0 items-center border-b border-border/50 pr-4 transition-[padding-left] duration-200 ease-in-out"
      style={{ paddingLeft: collapsed ? "calc(var(--traffic-light-clearance, 0px) + 40px)" : "1rem" }}
      data-tauri-drag-region
    >
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
  const { collapsed, toggleSidebar } = useSidebarCollapsed();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        const target = e.target as HTMLElement;
        if (
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable
        ) {
          return;
        }
        e.preventDefault();
        toggleSidebar();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebar]);

  const context: LayoutContext = { collapsed, toggleSidebar };

  return (
    <div className="flex h-screen flex-col">
      {import.meta.env.DEV && (
        <div className="shrink-0 bg-amber-500/90 px-3 py-0.5 text-center text-xs font-medium text-black">
          Dev frontend → {backendEnv ? `${backendEnv} backend` : "connecting…"}
        </div>
      )}
      <div className="relative flex min-h-0 flex-1">
        {/* Sidebar toggle — always at the same window position */}
        <button
          type="button"
          onClick={toggleSidebar}
          className="absolute top-px z-40 flex h-12 items-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          style={{ left: "max(var(--traffic-light-clearance, 0px), 0.75rem)" }}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <PanelLeft className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>

        <div
          className={`shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out ${collapsed ? "w-0" : "w-72"}`}
        >
          {isSettings ? (
            <SettingsSidebar />
          ) : (
            <Sidebar onAddProject={onAddProject} />
          )}
        </div>
        <main className="relative flex flex-1 flex-col overflow-hidden">
          <Outlet context={context} />
        </main>
      </div>
    </div>
  );
}
