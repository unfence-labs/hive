import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import SettingsSidebar from "./SettingsSidebar";
import Terminal from "./Terminal";
import { TerminalProvider, useTerminalContext } from "@/contexts/TerminalContext";
import { cn } from "@/lib/utils";
import type { Project } from "@/types";

interface AppLayoutProps {
  projects: Project[];
  loading: boolean;
  onAddProject: () => void;
  onAddWorkspace: (projectId: string) => Promise<unknown>;
  onArchiveWorkspace: (wsId: string) => Promise<void>;
}

function TerminalLayer() {
  const { activeTerminals, visibleTerminalWsId, closeTerminal } = useTerminalContext();

  return (
    <>
      {[...activeTerminals].map((wsId) => (
        <div
          key={wsId}
          className={cn(
            "absolute bottom-0 left-0 right-0 top-12 z-10 lg:right-80",
            wsId === visibleTerminalWsId ? "" : "invisible pointer-events-none",
          )}
        >
          <Terminal
            workspaceId={wsId}
            visible={wsId === visibleTerminalWsId}
            onExit={() => closeTerminal(wsId)}
          />
        </div>
      ))}
    </>
  );
}

export default function AppLayout({
  projects,
  loading,
  onAddProject,
  onAddWorkspace,
  onArchiveWorkspace,
}: AppLayoutProps) {
  const { pathname } = useLocation();
  const isSettings = pathname.startsWith("/settings");

  return (
    <TerminalProvider>
      <div className="flex h-screen">
        {isSettings ? (
          <SettingsSidebar projects={projects} />
        ) : (
          <Sidebar
            projects={projects}
            loading={loading}
            onAddProject={onAddProject}
            onAddWorkspace={onAddWorkspace}
            onArchiveWorkspace={onArchiveWorkspace}
          />
        )}
        <main className="relative flex flex-1 flex-col overflow-hidden">
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <Outlet />
            <TerminalLayer />
          </div>
        </main>
      </div>
    </TerminalProvider>
  );
}
