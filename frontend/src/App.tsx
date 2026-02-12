import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import ProjectView from "@/pages/ProjectView";
import WorkspaceView from "@/pages/WorkspaceView";
import AddProjectDialog from "@/components/AddProjectDialog";
import EmptyStateLogo from "@/components/EmptyStateLogo";
import { useProjects } from "@/hooks/useProjects";

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
            element={<EmptyStateLogo />}
          />
          <Route path="projects/:id" element={<ProjectView />} />
          <Route path="workspaces/:wsId" element={<WorkspaceView />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
