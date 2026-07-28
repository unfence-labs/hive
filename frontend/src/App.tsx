import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import AddProjectDialog from "@/components/AddProjectDialog";
import WorkspaceLauncher from "@/components/WorkspaceLauncher";
import HomeView from "@/pages/HomeView";
import NotificationSettings from "@/pages/settings/NotificationSettings";
import { useProjects } from "@/hooks/useProjects";
import { useConnection } from "@/hooks/useConnection";
import { isDesktopShell } from "@/lib/is-desktop";
import { BRAIN_WORKSPACE_ID } from "@/lib/brain";
import type { Project } from "@/types";
import { WorkspaceLiveDataProvider } from "@/contexts/WorkspaceLiveDataContext";
import { useWsCacheInvalidation } from "@/hooks/useWsCacheInvalidation";
import { useActiveSessionPrewarm } from "@/hooks/useActiveSessionPrewarm";
import { useNotificationToasts } from "@/hooks/useNotificationToasts";
import { wsTransport } from "@/lib/ws-transport";
import { HiveToaster } from "@/components/ui/toaster";

const AutomationDetail = lazy(() => import("@/pages/AutomationDetail"));
const WorkspaceView = lazy(() => import("@/pages/WorkspaceView"));
const BrainView = lazy(() => import("@/pages/BrainView"));
const AccountSettings = lazy(() => import("@/pages/settings/AccountSettings"));
const AppearanceSettings = lazy(() => import("@/pages/settings/AppearanceSettings"));
const ConnectionSettings = lazy(() => import("@/pages/settings/ConnectionSettings"));
const ServerSettings = lazy(() => import("@/pages/settings/ServerSettings"));
const AgentSettings = lazy(() => import("@/pages/settings/AgentSettings"));
const ModelsSettings = lazy(() => import("@/pages/settings/ModelsSettings"));
const ProjectDetail = lazy(() => import("@/pages/settings/ProjectDetail"));
const TeamSettings = lazy(() => import("@/pages/settings/TeamSettings"));
const PromptTemplatesSettings = lazy(() => import("@/pages/settings/PromptTemplatesSettings"));
const SkillsSettings = lazy(() => import("@/pages/settings/SkillsSettings"));
const InstructionsSettings = lazy(() => import("@/pages/settings/InstructionsSettings"));
const SubagentsSettings = lazy(() => import("@/pages/settings/SubagentsSettings"));
const CreateAutomationDialog = lazy(() => import("@/components/CreateAutomationDialog"));
const Installer = lazy(() => import("@/pages/installer/Installer"));

function NotificationToastsBridge({ projects }: { projects: Project[] }) {
  useNotificationToasts(projects);
  return null;
}

export default function App() {
  const { projects, loading, fetchProjects, createProjectWithWorkspace, createNewProjectWithWorkspace } = useProjects();
  const [showAddProject, setShowAddProject] = useState(false);
  const [showAddAutomation, setShowAddAutomation] = useState(false);
  // The installer is a layer in front of the app, not a variant of it: with no
  // server configured the desktop shell has nothing else to show, and an
  // already-configured app can open it again from Settings.
  //
  // Once open it comes down only when the installer says so. It stores the
  // connection partway through — its final screen connects accounts on the
  // server it just installed — so closing on `isConfigured` would cut the flow
  // short at exactly the point the newcomer still needs it.
  const { isConfigured } = useConnection();
  const needsInstaller = isDesktopShell() && !isConfigured;
  const [showInstaller, setShowInstaller] = useState(needsInstaller);
  useEffect(() => {
    if (needsInstaller) setShowInstaller(true);
  }, [needsInstaller]);
  // "New workspace from…" picker — owned here so both the global shortcuts
  // (WorkspaceLauncher) and the sidebar "+" context menu can open it.
  const [workspaceFrom, setWorkspaceFrom] = useState<{ open: boolean; projectId?: string }>({ open: false });
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

  return (
    <BrowserRouter>
      <WorkspaceLiveDataProvider workspaceIds={workspaceIds}>
        <HiveToaster />
        <WorkspaceLauncher
          pickerOpen={workspaceFrom.open}
          pickerProjectId={workspaceFrom.projectId}
          onPickerOpenChange={(open) =>
            setWorkspaceFrom((prev) => (open ? { ...prev, open: true } : { open: false }))
          }
        />
        <NotificationToastsBridge projects={projects} />
        <AddProjectDialog
          open={showAddProject}
          onOpenChange={setShowAddProject}
          onClone={createProjectWithWorkspace}
          onCreate={createNewProjectWithWorkspace}
        />
        <Suspense fallback={null}>
          {showInstaller && (
            <Installer onClose={() => setShowInstaller(false)} cancellable={isConfigured} />
          )}
        </Suspense>
        <Suspense fallback={null}>
          {showAddAutomation && (
            <CreateAutomationDialog
              open={showAddAutomation}
              onOpenChange={setShowAddAutomation}
            />
          )}
        </Suspense>
        <Suspense fallback={null}>
          <Routes>
            <Route
              element={
                <AppLayout
                  onAddProject={() => setShowAddProject(true)}
                  onAddAutomation={() => setShowAddAutomation(true)}
                  onNewWorkspaceFrom={(projectId) => setWorkspaceFrom({ open: true, projectId })}
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
              <Route path="automations/:automationId" element={<AutomationDetail />} />
              <Route path="settings" element={<Navigate to="/settings/appearance" replace />} />
              <Route path="settings/account" element={<AccountSettings />} />
              <Route path="settings/appearance" element={<AppearanceSettings />} />
              <Route
                path="settings/connection"
                element={
                  <ConnectionSettings
                    onRefreshConnection={() => { wsTransport.disconnectAll(); fetchProjects(); }}
                  />
                }
              />
              {isDesktopShell() && (
                <Route
                  path="settings/server"
                  element={<ServerSettings onOpenInstaller={() => setShowInstaller(true)} />}
                />
              )}
              <Route path="settings/notifications" element={<NotificationSettings />} />
              <Route path="settings/cli" element={<AgentSettings />} />
              <Route path="settings/models" element={<ModelsSettings />} />
              <Route path="settings/instructions" element={<InstructionsSettings />} />
              <Route path="settings/prompt" element={<PromptTemplatesSettings />} />
              <Route path="settings/skills" element={<SkillsSettings />} />
              <Route path="settings/team" element={<TeamSettings />} />
              <Route path="settings/subagents" element={<SubagentsSettings />} />
              <Route path="settings/repositories/:projectId" element={<ProjectDetail />} />
            </Route>
          </Routes>
        </Suspense>
      </WorkspaceLiveDataProvider>
    </BrowserRouter>
  );
}
