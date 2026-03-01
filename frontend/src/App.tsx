import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Toaster } from "sileo";
import "sileo/styles.css";
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
import AutomationsHome from "@/pages/AutomationsHome";
import { useProjects } from "@/hooks/useProjects";
import type { Project } from "@/types";
import { WorkspaceLiveDataProvider } from "@/contexts/WorkspaceLiveDataContext";
import { useWsCacheInvalidation } from "@/hooks/useWsCacheInvalidation";
import { useNotificationToasts } from "@/hooks/useNotificationToasts";
import { wsTransport } from "@/lib/ws-transport";

const AutomationDetail = lazy(() => import("@/pages/AutomationDetail"));
const PromptTemplatesSettings = lazy(() => import("@/pages/settings/PromptTemplatesSettings"));
const CreateAutomationDialog = lazy(() => import("@/components/CreateAutomationDialog"));

function NotificationToastsBridge({ projects }: { projects: Project[] }) {
  useNotificationToasts(projects);
  return null;
}

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
        <Toaster
          position="top-right"
          theme="dark"
          options={{
            fill: "#16161e",
            styles: {
              title: "text-[oklch(0.93_0.005_260)]!",
              description: "text-[oklch(0.707_0.022_261.325)]!",
              badge: "bg-[#262636]!",
              button: "bg-[#262636]! text-[oklch(0.93_0.005_260)]! hover:bg-[#2e2e40]!",
            },
          }}
        />
        <NotificationToastsBridge projects={projects} />
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
            <Route path="automations" element={<AutomationsHome onAddAutomation={() => setShowAddAutomation(true)} />} />
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
