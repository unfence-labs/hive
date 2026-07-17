import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import WorkspaceView from "@/pages/WorkspaceView";
import AccountSettings from "@/pages/settings/AccountSettings";
import AppearanceSettings from "@/pages/settings/AppearanceSettings";
import ConnectionSettings from "@/pages/settings/ConnectionSettings";
import NotificationSettings from "@/pages/settings/NotificationSettings";
import AgentSettings from "@/pages/settings/AgentSettings";
import ModelsSettings from "@/pages/settings/ModelsSettings";
import ProjectDetail from "@/pages/settings/ProjectDetail";
import BrainView from "@/pages/BrainView";
import AddProjectDialog from "@/components/AddProjectDialog";
import HomeView from "@/pages/HomeView";
import { useProjects } from "@/hooks/useProjects";
import { BRAIN_WORKSPACE_ID } from "@/lib/brain";
import type { Project } from "@/types";
import { WorkspaceLiveDataProvider } from "@/contexts/WorkspaceLiveDataContext";
import { useWsCacheInvalidation } from "@/hooks/useWsCacheInvalidation";
import { useActiveSessionPrewarm } from "@/hooks/useActiveSessionPrewarm";
import { useNotificationToasts } from "@/hooks/useNotificationToasts";
import { wsTransport } from "@/lib/ws-transport";
import { HiveToaster } from "@/components/ui/toaster";
import { isTauri } from "@/lib/is-tauri";
import { useServerUrl } from "@/hooks/useServerUrl";

const SetupWizard = lazy(() => import("@/pages/setup/SetupWizard"));
const AutomationDetail = lazy(() => import("@/pages/AutomationDetail"));
const TeamSettings = lazy(() => import("@/pages/settings/TeamSettings"));
const PromptTemplatesSettings = lazy(() => import("@/pages/settings/PromptTemplatesSettings"));
const SkillsSettings = lazy(() => import("@/pages/settings/SkillsSettings"));
const InstructionsSettings = lazy(() => import("@/pages/settings/InstructionsSettings"));
const SubagentsSettings = lazy(() => import("@/pages/settings/SubagentsSettings"));
const CreateAutomationDialog = lazy(() => import("@/components/CreateAutomationDialog"));

function NotificationToastsBridge({ projects }: { projects: Project[] }) {
  useNotificationToasts(projects);
  return null;
}

export default function App() {
  const { serverUrl } = useServerUrl();
  // First-run gate: in the Tauri desktop shell with no server configured yet,
  // show the install wizard. Non-invasive for the web build (isTauri() is false).
  const [wizardDismissed, setWizardDismissed] = useState(false);
  const showWizard = isTauri() && !serverUrl && !wizardDismissed;

  const { projects, loading, fetchProjects, createProjectWithWorkspace, createNewProjectWithWorkspace } = useProjects();
  const [showAddProject, setShowAddProject] = useState(false);
  const [showAddAutomation, setShowAddAutomation] = useState(false);
  const workspaceIds = useMemo(
    () =>
      Array.from(
        new Set([
          // The Brain is addressed as a synthetic workspace id over the same hub.
          BRAIN_WORKSPACE_ID,
          ...projects.flatMap((project) => (project.workspaces ?? []).map((workspace) => workspace.id)),
        ]),
      ),
    [projects],
  );

  useEffect(() => {
    if (loading) return;
    wsTransport.syncWorkspaces(workspaceIds);
  }, [loading, workspaceIds]);

  useWsCacheInvalidation(workspaceIds);

  // Prewarm each workspace's active-session history at bootstrap so the first
  // switch into a workspace is instant (no empty-state blank on cache-miss).
  useActiveSessionPrewarm(projects);

  useEffect(() => () => {
    wsTransport.disconnectAll();
  }, []);

  if (showWizard) {
    return (
      <Suspense fallback={null}>
        <SetupWizard onComplete={() => setWizardDismissed(true)} />
      </Suspense>
    );
  }

  return (
    <BrowserRouter>
      <WorkspaceLiveDataProvider workspaceIds={workspaceIds}>
        <HiveToaster />
        <NotificationToastsBridge projects={projects} />
        <AddProjectDialog
          open={showAddProject}
          onOpenChange={setShowAddProject}
          onClone={createProjectWithWorkspace}
          onCreate={createNewProjectWithWorkspace}
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
            <Route index element={<Navigate to="/home" replace />} />
            <Route
              path="home"
              element={<HomeView onAddProject={() => setShowAddProject(true)} />}
            />
            <Route path="projects" element={<Navigate to="/home" replace />} />
            <Route path="projects/:id" element={<Navigate to="/home" replace />} />
            <Route path="workspaces/:wsId" element={<WorkspaceView />} />
            <Route path="brain" element={<BrainView />} />
            <Route path="automations" element={<Navigate to="/home" replace />} />
            <Route path="automations/:automationId" element={<Suspense fallback={null}><AutomationDetail /></Suspense>} />
            <Route path="settings" element={<Navigate to="/settings/appearance" replace />} />
            <Route path="settings/account" element={<AccountSettings />} />
            <Route path="settings/appearance" element={<AppearanceSettings />} />
            <Route path="settings/connection" element={<ConnectionSettings onRefreshConnection={() => { wsTransport.disconnectAll(); fetchProjects(); }} />} />
            <Route path="settings/notifications" element={<NotificationSettings />} />
            <Route path="settings/cli" element={<AgentSettings />} />
            <Route path="settings/models" element={<ModelsSettings />} />
            <Route path="settings/instructions" element={<Suspense fallback={null}><InstructionsSettings /></Suspense>} />
            <Route path="settings/prompt" element={<Suspense fallback={null}><PromptTemplatesSettings /></Suspense>} />
            <Route path="settings/skills" element={<Suspense fallback={null}><SkillsSettings /></Suspense>} />
            <Route path="settings/team" element={<Suspense fallback={null}><TeamSettings /></Suspense>} />
            <Route path="settings/subagents" element={<Suspense fallback={null}><SubagentsSettings /></Suspense>} />
            <Route path="settings/repositories/:projectId" element={<ProjectDetail />} />
          </Route>
        </Routes>
      </WorkspaceLiveDataProvider>
    </BrowserRouter>
  );
}
