import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import SettingsSidebar from "./SettingsSidebar";

interface AppLayoutProps {
  onAddProject: () => void;
}

export default function AppLayout({ onAddProject }: AppLayoutProps) {
  const { pathname } = useLocation();
  const isSettings = pathname.startsWith("/settings");

  return (
    <div className="flex h-screen">
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
  );
}
