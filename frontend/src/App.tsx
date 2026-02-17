import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import WorkspaceView from "@/pages/WorkspaceView";
import AccountSettings from "@/pages/settings/AccountSettings";
import AppearanceSettings from "@/pages/settings/AppearanceSettings";
import ConnectionSettings from "@/pages/settings/ConnectionSettings";
import NotificationSettings from "@/pages/settings/NotificationSettings";
import ProjectDetail from "@/pages/settings/ProjectDetail";
import AddProjectDialog from "@/components/AddProjectDialog";
import EmptyStateLogo from "@/components/EmptyStateLogo";
import LogoSquareTempPage from "@/pages/LogoSquareTempPage";
import { useProjects } from "@/hooks/useProjects";
import { wsTransport } from "@/lib/ws-transport";

export default function App() {
  const { projects, loading, fetchProjects, createWorkspace, createProjectWithWorkspace, deleteProject, archiveWorkspace } = useProjects();
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
        onSubmit={createProjectWithWorkspace}
      />
      <Routes>
        <Route path="tmp/logo-carre" element={<LogoSquareTempPage />} />
        <Route
          element={
            <AppLayout
              projects={projects}
              loading={loading}
              onAddProject={() => setShowAddProject(true)}
              onAddWorkspace={createWorkspace}
              onArchiveWorkspace={archiveWorkspace}
            />
          }
        >
          <Route index element={<Navigate to="/projects" replace />} />
          <Route
            path="projects"
            element={<EmptyStateLogo onAddProject={() => setShowAddProject(true)} />}
          />
          <Route path="projects/:id" element={<Navigate to="/projects" replace />} />
          <Route path="workspaces/:wsId" element={<WorkspaceView />} />
          <Route path="settings" element={<Navigate to="/settings/account" replace />} />
          <Route path="settings/account" element={<AccountSettings />} />
          <Route path="settings/appearance" element={<AppearanceSettings />} />
          <Route path="settings/connection" element={<ConnectionSettings onRefreshConnection={() => { wsTransport.disconnectAll(); fetchProjects(); }} />} />
          <Route path="settings/notifications" element={<NotificationSettings />} />
          <Route path="settings/repositories/:projectId" element={<ProjectDetail projects={projects} onDeleteProject={deleteProject} />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
