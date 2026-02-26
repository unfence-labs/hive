import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import WorkspaceView from "@/pages/WorkspaceView";
import AccountSettings from "@/pages/settings/AccountSettings";
import AppearanceSettings from "@/pages/settings/AppearanceSettings";
import ConnectionSettings from "@/pages/settings/ConnectionSettings";
import NotificationSettings from "@/pages/settings/NotificationSettings";
import AgentSettings from "@/pages/settings/AgentSettings";
import ProjectDetail from "@/pages/settings/ProjectDetail";
import AddProjectDialog from "@/components/AddProjectDialog";
import EmptyStateLogo from "@/components/EmptyStateLogo";
import { useProjects } from "@/hooks/useProjects";
import { WorkspaceLiveDataProvider } from "@/contexts/WorkspaceLiveDataContext";
import { useWsCacheInvalidation } from "@/hooks/useWsCacheInvalidation";
import { wsTransport } from "@/lib/ws-transport";

const AutomationDetail = lazy(() => import("@/pages/AutomationDetail"));
const PromptTemplatesSettings = lazy(() => import("@/pages/settings/PromptTemplatesSettings"));
const CreateAutomationDialog = lazy(() => import("@/components/CreateAutomationDialog"));

export default function App() {
  const { projects, loading, fetchProjects, createProjectWithWorkspace } = useProjects();
  const [showAddProject, setShowAddProject] = useState(false);
  const [showAddAutomation, setShowAddAutomation] = useState(false);
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

  useWsCacheInvalidation(workspaceIds);

  useEffect(() => () => {
    wsTransport.disconnectAll();
  }, []);

  return (
    <BrowserRouter>
      <WorkspaceLiveDataProvider workspaceIds={workspaceIds}>
        <AddProjectDialog
          open={showAddProject}
          onOpenChange={setShowAddProject}
          onSubmit={createProjectWithWorkspace}
        />
        <Suspense fallback={null}>
          {showAddAutomation && (
            <CreateAutomationDialog
              open={showAddAutomation}
              onOpenChange={setShowAddAutomation}
            />
          )}
        </Suspense>
        <Routes>
          <Route
            element={
              <AppLayout
                onAddProject={() => setShowAddProject(true)}
                onAddAutomation={() => setShowAddAutomation(true)}
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
            <Route path="automations/:automationId" element={<Suspense fallback={null}><AutomationDetail /></Suspense>} />
            <Route path="settings" element={<Navigate to="/settings/appearance" replace />} />
            <Route path="settings/account" element={<AccountSettings />} />
            <Route path="settings/appearance" element={<AppearanceSettings />} />
            <Route path="settings/connection" element={<ConnectionSettings onRefreshConnection={() => { wsTransport.disconnectAll(); fetchProjects(); }} />} />
            <Route path="settings/notifications" element={<NotificationSettings />} />
            <Route path="settings/agents" element={<AgentSettings />} />
            <Route path="settings/prompt-templates" element={<Suspense fallback={null}><PromptTemplatesSettings /></Suspense>} />
            <Route path="settings/repositories/:projectId" element={<ProjectDetail />} />
          </Route>
        </Routes>
      </WorkspaceLiveDataProvider>
    </BrowserRouter>
  );
}
