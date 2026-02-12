import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import SettingsView from "@/pages/SettingsView";
import WorkspaceView from "@/pages/WorkspaceView";
import AddProjectDialog from "@/components/AddProjectDialog";
import EmptyStateLogo from "@/components/EmptyStateLogo";
import { useProjects } from "@/hooks/useProjects";
import { wsTransport } from "@/lib/ws-transport";

export default function App() {
  const { projects, loading, createProject, createWorkspace } = useProjects();
  const [showAddProject, setShowAddProject] = useState(false);
  const workspaceIds = useMemo(
    () =>
      Array.from(
        new Set(
          projects.flatMap((project) => (project.workspaces ?? []).map((workspace) => workspace.id)),
        ),
      ),
    [projects],
  );

  useEffect(() => {
    if (loading) return;
    wsTransport.syncWorkspaces(workspaceIds);
  }, [loading, workspaceIds]);

  useEffect(() => () => {
    wsTransport.disconnectAll();
  }, []);

  return (
    <BrowserRouter>
      <AddProjectDialog
        open={showAddProject}
        onOpenChange={setShowAddProject}
        onSubmit={async (url) => {
          const project = await createProject(url);
          const workspace = await createWorkspace(project.id);
          return workspace;
        }}
      />
      <Routes>
        <Route
          element={
            <AppLayout
              projects={projects}
              loading={loading}
              onAddProject={() => setShowAddProject(true)}
              onAddWorkspace={createWorkspace}
            />
          }
        >
          <Route index element={<Navigate to="/projects" replace />} />
          <Route
            path="projects"
            element={<EmptyStateLogo />}
          />
          <Route path="projects/:id" element={<Navigate to="/projects" replace />} />
          <Route path="workspaces/:wsId" element={<WorkspaceView />} />
          <Route path="settings" element={<SettingsView />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
