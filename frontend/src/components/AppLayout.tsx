import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import SettingsSidebar from "./SettingsSidebar";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";

interface AppLayoutProps {
  onAddProject: () => void;
}

export default function AppLayout({ onAddProject }: AppLayoutProps) {
  const { pathname } = useLocation();
  const isSettings = pathname.startsWith("/settings");
  const { backendEnv } = useConnectionStatus();

  return (
    <div className="flex h-screen flex-col">
      {import.meta.env.DEV && (
        <div className="shrink-0 bg-amber-500/90 px-3 py-0.5 text-center text-xs font-medium text-black">
          Dev frontend → {backendEnv ? `${backendEnv} backend` : "connecting…"}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        {isSettings ? (
          <SettingsSidebar />
        ) : (
          <Sidebar onAddProject={onAddProject} />
        )}
        <main className="relative flex flex-1 flex-col overflow-hidden">
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
