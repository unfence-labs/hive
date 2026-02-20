import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import SettingsSidebar from "./SettingsSidebar";
import Terminal from "./Terminal";
import { TerminalProvider, useTerminalContext } from "@/contexts/TerminalContext";
import { cn } from "@/lib/utils";

interface AppLayoutProps {
  onAddProject: () => void;
}

function TerminalLayer() {
  const { activeTerminals, visibleTerminalWsId, closeTerminal } = useTerminalContext();

  return (
    <>
      {[...activeTerminals].map((wsId) => (
        <div
          key={wsId}
          className={cn(
            "absolute bottom-0 left-0 right-0 top-12 z-10 lg:right-[420px]",
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

export default function AppLayout({ onAddProject }: AppLayoutProps) {
  const { pathname } = useLocation();
  const isSettings = pathname.startsWith("/settings");

  return (
    <TerminalProvider>
      <div className="flex h-screen">
        {isSettings ? (
          <SettingsSidebar />
        ) : (
          <Sidebar onAddProject={onAddProject} />
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
