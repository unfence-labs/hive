import { useCallback, useEffect, useState } from "react";
import { Outlet, useLocation, useOutletContext } from "react-router-dom";
import { Group, Panel, useDefaultLayout, usePanelRef } from "react-resizable-panels";
import Sidebar from "./Sidebar";
import SettingsSidebar from "./SettingsSidebar";
import { ResizeHandle } from "./ResizeHandle";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";

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
      style={{ paddingLeft: collapsed ? "max(var(--traffic-light-clearance, 0px), 1rem)" : "1rem" }}
      data-tauri-drag-region
    >
      {children}
    </div>
  );
}

interface AppLayoutProps {
  onAddProject: () => void;
  onAddAutomation?: () => void;
}

export default function AppLayout({ onAddProject, onAddAutomation }: AppLayoutProps) {
  const { pathname } = useLocation();
  const isSettings = pathname.startsWith("/settings");
  const { backendEnv } = useConnectionStatus();

  const sidebarPanelRef = usePanelRef();
  const [collapsed, setCollapsed] = useState(false);

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "hive-app-layout",
    storage: localStorage,
  });

  const toggleSidebar = useCallback(() => {
    const panel = sidebarPanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) {
      panel.expand();
    } else {
      panel.collapse();
    }
  }, [sidebarPanelRef]);

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

  const handleSidebarResize = useCallback(() => {
    const panel = sidebarPanelRef.current;
    if (!panel) return;
    setCollapsed(panel.isCollapsed());
  }, [sidebarPanelRef]);

  const context: LayoutContext = { collapsed, toggleSidebar };

  return (
    <div className="flex h-screen flex-col">
      {import.meta.env.DEV && (
        <div className="shrink-0 bg-amber-500/90 px-3 py-0.5 text-center text-xs font-medium text-black">
          Dev frontend → {backendEnv ? `${backendEnv} backend` : "connecting…"}
        </div>
      )}
      <Group
        orientation="horizontal"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
        style={{ flex: 1, minHeight: 0 }}
      >
        <Panel
          id="sidebar"
          panelRef={sidebarPanelRef}
          collapsible
          collapsedSize={0}
          minSize={200}
          maxSize={400}
          defaultSize="18%"
          onResize={handleSidebarResize}
          className="overflow-hidden"
        >
          {isSettings ? (
            <SettingsSidebar />
          ) : (
            <Sidebar onAddProject={onAddProject} onAddAutomation={onAddAutomation} />
          )}
        </Panel>
        <ResizeHandle orientation="vertical" />
        <Panel id="main">
          <main className="relative flex h-full flex-col overflow-hidden">
            <Outlet context={context} />
          </main>
        </Panel>
      </Group>
    </div>
  );
}
