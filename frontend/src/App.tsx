import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import ProjectView from "@/pages/ProjectView";
import WorkspaceView from "@/pages/WorkspaceView";
import AddProjectDialog from "@/components/AddProjectDialog";
import { useProjects } from "@/hooks/useProjects";
import hiveLogo from "@/assets/hive-logo.png";

export default function App() {
  const { projects, loading, createProject, deleteProject } = useProjects();
  const [showAddProject, setShowAddProject] = useState(false);

  return (
    <BrowserRouter>
      <AddProjectDialog
        open={showAddProject}
        onOpenChange={setShowAddProject}
        onSubmit={createProject}
      />
      <Routes>
        <Route
          element={
            <AppLayout
              projects={projects}
              loading={loading}
              onAddProject={() => setShowAddProject(true)}
              onDeleteProject={deleteProject}
            />
          }
        >
          <Route index element={<Navigate to="/projects" replace />} />
          <Route
            path="projects"
            element={
              <div className="flex h-full items-center justify-center">
                <img
                  src={hiveLogo}
                  alt="Hive logo"
                  className="h-44 w-44 object-contain md:h-56 md:w-56"
                />
              </div>
            }
          />
          <Route path="projects/:id" element={<ProjectView />} />
          <Route path="workspaces/:wsId" element={<WorkspaceView />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
