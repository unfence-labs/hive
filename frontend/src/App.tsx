import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
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
import { useDesktopUpdate } from "@/hooks/useDesktopUpdate";
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
const UpdatesSettings = lazy(() => import("@/pages/settings/UpdatesSettings"));
const CreateAutomationDialog = lazy(() => import("@/components/CreateAutomationDialog"));
const Installer = lazy(() => import("@/pages/installer/Installer"));

function NotificationToastsBridge({ projects }: { projects: Project[] }) {
  useNotificationToasts(projects);
  return null;
}

/** What the screen shows while the installer chunk loads: the theme background
 * and nothing else. When Hive grows a real splash screen, it lives here. */
function BootScreen() {
  return <div className="fixed inset-0 bg-background" />;
}

/**
 * The gate. An unconfigured app has exactly one thing to show — the installer —
 * and mounting anything else would only fire requests at a server that does not
 * exist yet. The configured app mounts for the first time when the installer
 * says it is done, and bootstraps against the server it just set up.
 *
 * The mode is captured when the installer opens, not derived live: the install
 * stores its connection partway through (the final screen connects accounts on
 * the new server), and that must not flip a booting gate into an overlay with
 * an app suddenly running underneath it. Reopened from Settings over a
 * configured app, the installer is an overlay instead, and abandoning it
 * changes nothing.
 */
export default function App() {
  const { isConfigured, isSetupPending } = useConnection();
  const requiresSetup = !isConfigured || isSetupPending;
  const [installer, setInstaller] = useState<"gate" | "overlay" | null>(() =>
    requiresSetup ? "gate" : null,
  );
  useEffect(() => {
    if (requiresSetup) setInstaller((current) => current ?? "gate");
  }, [requiresSetup]);
  const closeInstaller = useCallback(() => setInstaller(null), []);

  // App-level, not ConfiguredApp-level: an installed build stuck on the
  // installer gate must still be offered updates — that gate is exactly where
  // a broken old build would strand its user.
  useDesktopUpdate();

  return (
    <>
      <HiveToaster />
      {installer === "gate" ? (
        <Suspense fallback={<BootScreen />}>
          <Installer onClose={closeInstaller} />
        </Suspense>
      ) : (
        <ConfiguredApp
          installerOpen={installer === "overlay"}
          onOpenInstaller={() => setInstaller("overlay")}
          onCloseInstaller={closeInstaller}
        />
      )}
    </>
  );
}

function ConfiguredApp({
  installerOpen,
  onOpenInstaller,
  onCloseInstaller,
}: {
  installerOpen: boolean;
  onOpenInstaller: () => void;
  onCloseInstaller: () => void;
}) {
  const { projects, loading, fetchProjects, createProjectWithWorkspace, createNewProjectWithWorkspace } = useProjects();
  const [showAddProject, setShowAddProject] = useState(false);
  const [showAddAutomation, setShowAddAutomation] = useState(false);
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
          {installerOpen && <Installer onClose={onCloseInstaller} cancellable />}
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
                  element={<ServerSettings onOpenInstaller={onOpenInstaller} />}
                />
              )}
              <Route path="settings/notifications" element={<NotificationSettings />} />
              <Route path="settings/updates" element={<UpdatesSettings />} />
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
