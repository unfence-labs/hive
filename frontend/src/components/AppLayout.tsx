import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useOutletContext } from "react-router-dom";
import { Group, Panel, useDefaultLayout, usePanelRef } from "react-resizable-panels";
import Sidebar from "./Sidebar";
import SettingsSidebar from "./SettingsSidebar";
import { ResizeHandle } from "./ResizeHandle";
import { Spinner } from "@/components/ui/spinner";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import { useAppCommand } from "@/hooks/useAppCommand";
import { cn } from "@/lib/utils";

/**
 * Temporarily enable a CSS transition on a panel's outer element so that
 * programmatic collapse/expand (e.g. Cmd+B) animates smoothly.
 *
 * react-resizable-panels intentionally sets no transitions (they'd break
 * drag tracking), so we inject one right before the action and strip it
 * once the animation finishes.
 */
function animatePanelTransition(el: HTMLElement, durationMs = 200) {
  el.style.transition = `flex-grow ${durationMs}ms ease-in-out`;
  const cleanup = () => {
    el.style.transition = "";
    el.removeEventListener("transitionend", cleanup);
  };
  el.addEventListener("transitionend", cleanup);
  setTimeout(cleanup, durationMs + 100);
}

export interface LayoutContext {
  collapsed: boolean;
  toggleSidebar: () => void;
}

const defaultContext: LayoutContext = { collapsed: false, toggleSidebar: () => {} };

export function useLayoutContext(): LayoutContext {
  const ctx = useOutletContext() as LayoutContext | undefined;
  return ctx ?? defaultContext;
}

/**
 * The shell page header shared by every main view: a fixed-height (h-12) bar
 * that sits on the shell *above* the floating {@link CenterCard}. It owns the
 * macOS traffic-light clearance (left padding grows when the sidebar is
 * collapsed) and the Tauri window drag region, so every view gets consistent
 * window chrome for free. Pass `className` to tune layout (e.g. `gap-2`).
 */
export function PageHeader({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  const { collapsed } = useLayoutContext();
  return (
    <div
      className={cn(
        "relative flex h-12 shrink-0 items-center pr-4 transition-[padding-left] duration-200 ease-in-out",
        className,
      )}
      style={{ paddingLeft: collapsed ? "max(var(--traffic-light-clearance, 0px), 1rem)" : "1rem" }}
      data-tauri-drag-region
    >
      {children}
    </div>
  );
}

export function SettingsHeader({ children }: { children: React.ReactNode }) {
  return <PageHeader>{children}</PageHeader>;
}

interface AppLayoutProps {
  onAddProject: () => void;
  onNewWorkspaceFrom?: (projectId: string) => void;
  onAddAutomation?: () => void;
}

export default function AppLayout({ onAddProject, onAddAutomation, onNewWorkspaceFrom }: AppLayoutProps) {
  const { pathname } = useLocation();
  const isSettings = pathname.startsWith("/settings");
  const { backendEnv } = useConnectionStatus();

  const sidebarPanelRef = usePanelRef();
  const sidebarElementRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "hive-app-layout",
    storage: localStorage,
  });

  const toggleSidebar = useCallback(() => {
    const panel = sidebarPanelRef.current;
    const el = sidebarElementRef.current;
    if (!panel) return;

    if (el) animatePanelTransition(el);

    if (panel.isCollapsed()) {
      panel.expand();
    } else {
      panel.collapse();
    }
  }, [sidebarPanelRef]);

  useAppCommand("toggle-sidebar", toggleSidebar);

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
    // h-full, not h-screen: vh units don't rescale under CSS zoom (useAppZoom).
    <div className="flex h-full flex-col bg-sidebar">
      {import.meta.env.DEV && (
        <div className="shrink-0 bg-warning/90 px-3 py-0.5 text-center text-xs font-medium text-warning-contrast">
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
          elementRef={sidebarElementRef}
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
            <Sidebar onAddProject={onAddProject} onAddAutomation={onAddAutomation} onNewWorkspaceFrom={onNewWorkspaceFrom} />
          )}
        </Panel>
        <ResizeHandle orientation="vertical" cardSide="right" />
        <Panel id="main">
          <main className="relative flex h-full flex-col overflow-hidden">
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center">
                  <Spinner className="size-6 text-muted-foreground" />
                </div>
              }
            >
              <Outlet context={context} />
            </Suspense>
          </main>
        </Panel>
      </Group>
    </div>
  );
}
