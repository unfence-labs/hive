import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { WorkspaceCommandPalette } from "@/components/WorkspaceCommandPalette";
import type { CommandPaletteAction } from "@/components/WorkspaceCommandPalette";
import { ProjectPickerDialog } from "@/components/ProjectPickerDialog";
import NewWorkspaceFromDialog from "@/components/NewWorkspaceFromDialog";
import { useProjects } from "@/hooks/useProjects";
import { useAppZoom } from "@/hooks/useAppZoom";
import { dispatchAppCommand } from "@/lib/app-commands";

interface WorkspaceLauncherProps {
  /** "New workspace from…" picker state — owned by App so the sidebar can open it too. */
  pickerOpen: boolean;
  pickerProjectId?: string;
  onPickerOpenChange: (open: boolean) => void;
}

/**
 * Global command surface: owns the ⌘K palette and application/navigation
 * shortcuts, plus ⌘N workspace creation. View-specific commands are dispatched
 * to the active Workspace or Brain conversation.
 */
export default function WorkspaceLauncher({
  pickerOpen,
  pickerProjectId,
  onPickerOpenChange,
}: WorkspaceLauncherProps) {
  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const { projects, createWorkspace } = useProjects();
  const navigate = useNavigate();
  const location = useLocation();
  const creatingRef = useRef(false);
  const { zoomIn, zoomOut, resetZoom } = useAppZoom();

  const activeWsId = matchPath("/workspaces/:wsId", location.pathname)?.params.wsId;
  const workspaceCommandsEnabled = Boolean(activeWsId || location.pathname === "/brain");
  const contextProject = useMemo(() => {
    if (activeWsId) {
      const project = projects.find((p) => p.workspaces.some((w) => w.id === activeWsId));
      if (project) return project;
    }
    return projects.length === 1 ? projects[0] : undefined;
  }, [projects, activeWsId]);

  const createInProject = useCallback(
    async (projectId: string) => {
      if (creatingRef.current) return;
      creatingRef.current = true;
      try {
        const workspace = await createWorkspace(projectId);
        navigate(`/workspaces/${workspace.id}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to create workspace");
      } finally {
        creatingRef.current = false;
      }
    },
    [createWorkspace, navigate],
  );

  const instantCreate = useCallback(() => {
    if (contextProject) {
      void createInProject(contextProject.id);
    } else {
      setProjectPickerOpen(true);
    }
  }, [contextProject, createInProject]);

  const executeCommand = useCallback((command: CommandPaletteAction) => {
    setSpotlightOpen(false);
    switch (command) {
      case "new-workspace":
        instantCreate();
        return;
      case "new-workspace-from":
        onPickerOpenChange(true);
        return;
      case "settings":
        if (!location.pathname.startsWith("/settings")) {
          navigate("/settings/appearance", { state: { from: location.pathname } });
        }
        return;
      case "zoom-in":
        zoomIn();
        return;
      case "zoom-out":
        zoomOut();
        return;
      case "reset-zoom":
        resetZoom();
        return;
      case "back":
        navigate(-1);
        return;
      case "forward":
        navigate(1);
        return;
      default:
        if (workspaceCommandsEnabled) dispatchAppCommand(command);
    }
  }, [instantCreate, location.pathname, navigate, onPickerOpenChange, resetZoom, workspaceCommandsEnabled, zoomIn, zoomOut]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.altKey) return;
      const key = e.key.toLowerCase();

      if (e.ctrlKey && !e.metaKey && key === "tab") {
        if (!workspaceCommandsEnabled) return;
        e.preventDefault();
        executeCommand(e.shiftKey ? "previous-tab" : "next-tab");
        return;
      }

      if (!(e.metaKey || e.ctrlKey)) return;
      const leftBracket = e.code === "BracketLeft" || key === "[" || key === "{";
      const rightBracket = e.code === "BracketRight" || key === "]" || key === "}";

      if (key === "k" && !e.shiftKey) {
        e.preventDefault();
        dispatchAppCommand("dismiss-view-dialogs");
        onPickerOpenChange(false);
        setProjectPickerOpen(false);
        setSpotlightOpen((prev) => !prev);
      } else if (key === "n") {
        e.preventDefault();
        setProjectPickerOpen(false);
        executeCommand(e.shiftKey ? "new-workspace-from" : "new-workspace");
      } else if (key === "," && !e.shiftKey) {
        e.preventDefault();
        executeCommand("settings");
      } else if (key === "0" && !e.shiftKey) {
        e.preventDefault();
        executeCommand("reset-zoom");
      } else if (key === "+" || key === "=") {
        e.preventDefault();
        executeCommand("zoom-in");
      } else if (key === "-" && !e.shiftKey) {
        e.preventDefault();
        executeCommand("zoom-out");
      } else if (leftBracket) {
        if (e.shiftKey && !workspaceCommandsEnabled) return;
        e.preventDefault();
        executeCommand(e.shiftKey ? "previous-tab" : "back");
      } else if (rightBracket) {
        if (e.shiftKey && !workspaceCommandsEnabled) return;
        e.preventDefault();
        executeCommand(e.shiftKey ? "next-tab" : "forward");
      } else if (key === "p" && !e.shiftKey) {
        if (!workspaceCommandsEnabled) return;
        e.preventDefault();
        executeCommand("quick-open-file");
      } else if (key === "t" && !e.shiftKey) {
        if (!workspaceCommandsEnabled) return;
        e.preventDefault();
        executeCommand("new-chat");
      } else if (key === "g") {
        if (!workspaceCommandsEnabled) return;
        e.preventDefault();
        executeCommand(e.shiftKey ? "find-previous" : "find-next");
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [executeCommand, onPickerOpenChange, workspaceCommandsEnabled]);

  return (
    <>
      <WorkspaceCommandPalette
        open={spotlightOpen}
        onOpenChange={setSpotlightOpen}
        workspaceCommandsEnabled={workspaceCommandsEnabled}
        onCommand={executeCommand}
      />
      <ProjectPickerDialog
        open={projectPickerOpen}
        onOpenChange={setProjectPickerOpen}
        onSelect={(projectId) => void createInProject(projectId)}
      />
      <NewWorkspaceFromDialog
        open={pickerOpen}
        onOpenChange={onPickerOpenChange}
        defaultProjectId={pickerProjectId ?? contextProject?.id}
      />
    </>
  );
}
