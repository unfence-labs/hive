import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import type { Project } from "@/types";

interface AppLayoutProps {
  projects: Project[];
  loading: boolean;
  onAddProject: () => void;
  onAddWorkspace: (projectId: string) => Promise<unknown>;
}

export default function AppLayout({
  projects,
  loading,
  onAddProject,
  onAddWorkspace,
}: AppLayoutProps) {
  return (
    <div className="flex h-screen">
      <Sidebar
        projects={projects}
        loading={loading}
        onAddProject={onAddProject}
        onAddWorkspace={onAddWorkspace}
      />
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
