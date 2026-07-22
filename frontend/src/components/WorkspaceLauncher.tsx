import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { WorkspaceCommandPalette } from "@/components/WorkspaceCommandPalette";
import { ProjectPickerDialog } from "@/components/ProjectPickerDialog";
import NewWorkspaceFromDialog from "@/components/NewWorkspaceFromDialog";
import { useProjects } from "@/hooks/useProjects";

/**
 * Global workspace-creation surface: ⌘K spotlight, ⌘N instant create from the
 * default branch, ⌘⇧N "new workspace from…" picker. ⌘N resolves the project
 * from the active workspace (or the only project); when ambiguous it asks for
 * the project only — the source stays the default branch.
 */
export default function WorkspaceLauncher() {
  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const { projects, createWorkspace } = useProjects();
  const navigate = useNavigate();
  const location = useLocation();
  const creatingRef = useRef(false);

  const activeWsId = matchPath("/workspaces/:wsId", location.pathname)?.params.wsId;
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

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "k" && !e.shiftKey) {
        e.preventDefault();
        setPickerOpen(false);
        setProjectPickerOpen(false);
        setSpotlightOpen((prev) => !prev);
      } else if (key === "n") {
        e.preventDefault();
        setSpotlightOpen(false);
        setProjectPickerOpen(false);
        if (e.shiftKey) {
          setPickerOpen(true);
        } else {
          instantCreate();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [instantCreate]);

  return (
    <>
      <WorkspaceCommandPalette
        open={spotlightOpen}
        onOpenChange={setSpotlightOpen}
        onNewWorkspace={instantCreate}
        onNewWorkspaceFrom={() => setPickerOpen(true)}
      />
      <ProjectPickerDialog
        open={projectPickerOpen}
        onOpenChange={setProjectPickerOpen}
        onSelect={(projectId) => void createInProject(projectId)}
      />
      <NewWorkspaceFromDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        defaultProjectId={contextProject?.id}
      />
    </>
  );
}
