import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
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
import { useProjects } from "@/hooks/useProjects";
import type { Project } from "@/types";
import { WorkspaceLiveDataProvider } from "@/contexts/WorkspaceLiveDataContext";
import { useWsCacheInvalidation } from "@/hooks/useWsCacheInvalidation";
import { useNotificationToasts } from "@/hooks/useNotificationToasts";
import { wsTransport } from "@/lib/ws-transport";

const AutomationDetail = lazy(() => import("@/pages/AutomationDetail"));
const MosaicView = lazy(() => import("@/pages/MosaicView"));
const PromptTemplatesSettings = lazy(() => import("@/pages/settings/PromptTemplatesSettings"));
const CreateAutomationDialog = lazy(() => import("@/components/CreateAutomationDialog"));

function GlobalHooks({ projects }: { projects: Project[] }) {
  useMosaicShortcut();
  useNotificationToasts(projects);
  return null;
}

/** Global Cmd+G / Ctrl+G toggle for Mosaic View. */
function useMosaicShortcut() {
  const navigate = useNavigate();
  const location = useLocation();
  const prevPathRef = useRef("/home");

  // Track previous non-mosaic path for toggle-back navigation
  useEffect(() => {
    if (location.pathname !== "/mosaic") {
      prevPathRef.current = location.pathname;
    }
  }, [location.pathname]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "g") return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      e.preventDefault();
      if (location.pathname === "/mosaic") {
        navigate(prevPathRef.current);
      } else {
        navigate("/mosaic");
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate, location.pathname]);
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
        <GlobalHooks projects={projects} />
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
            <Route index element={<Navigate to="/home" replace />} />
            <Route
              path="home"
              element={<EmptyStateLogo onAddProject={() => setShowAddProject(true)} />}
            />
            <Route path="projects" element={<Navigate to="/home" replace />} />
            <Route path="projects/:id" element={<Navigate to="/home" replace />} />
            <Route path="workspaces/:wsId" element={<WorkspaceView />} />
            <Route path="automations" element={<Navigate to="/home" replace />} />
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
          <Route path="mosaic" element={<Suspense fallback={null}><MosaicView /></Suspense>} />
        </Routes>
      </WorkspaceLiveDataProvider>
    </BrowserRouter>
  );
}
