import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Terminal from "./Terminal";
import { TerminalProvider, useTerminalContext } from "@/contexts/TerminalContext";
import { cn } from "@/lib/utils";
import type { Project } from "@/types";

interface AppLayoutProps {
  projects: Project[];
  loading: boolean;
  onAddProject: () => void;
  onAddWorkspace: (projectId: string) => Promise<unknown>;
}

function TerminalLayer() {
  const { activeTerminals, visibleTerminalWsId, closeTerminal } = useTerminalContext();

  return (
    <>
      {[...activeTerminals].map((wsId) => (
        <div
          key={wsId}
          className={cn(
            "absolute inset-x-0 bottom-0 top-12 z-10",
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
}: AppLayoutProps) {
  return (
    <TerminalProvider>
      <div className="flex h-screen">
        <Sidebar
          projects={projects}
          loading={loading}
          onAddProject={onAddProject}
          onAddWorkspace={onAddWorkspace}
        />
        <main className="relative flex-1 overflow-hidden">
          <Outlet />
          <TerminalLayer />
        </main>
      </div>
    </TerminalProvider>
  );
}
