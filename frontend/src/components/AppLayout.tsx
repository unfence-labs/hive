import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import type { Project } from "@/types";

interface AppLayoutProps {
  projects: Project[];
  loading: boolean;
  onAddProject: () => void;
  onDeleteProject: (id: string) => Promise<void>;
}

export default function AppLayout({
  projects,
  loading,
  onAddProject,
  onDeleteProject,
}: AppLayoutProps) {
  return (
    <div className="flex h-screen">
      <Sidebar
        projects={projects}
        loading={loading}
        onAddProject={onAddProject}
        onDeleteProject={onDeleteProject}
      />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
