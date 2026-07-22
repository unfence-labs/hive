import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { WorkspaceCommandPalette } from "@/components/WorkspaceCommandPalette";
import NewWorkspaceFromDialog from "@/components/NewWorkspaceFromDialog";
import { useProjects } from "@/hooks/useProjects";

/**
 * Global workspace-creation surface: ⌘K spotlight, ⌘N instant create from the
 * default branch, ⌘⇧N "new workspace from…" picker. ⌘N resolves the project
 * from the active workspace (or the only project) and falls back to the picker
 * when ambiguous.
 */
export default function WorkspaceLauncher() {
  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
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

  const instantCreate = useCallback(async () => {
    if (creatingRef.current) return;
    if (!contextProject) {
      setPickerOpen(true);
      return;
    }
    creatingRef.current = true;
    try {
      const workspace = await createWorkspace(contextProject.id);
      navigate(`/workspaces/${workspace.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create workspace");
    } finally {
      creatingRef.current = false;
    }
  }, [contextProject, createWorkspace, navigate]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "k" && !e.shiftKey) {
        e.preventDefault();
        setPickerOpen(false);
        setSpotlightOpen((prev) => !prev);
      } else if (key === "n") {
        e.preventDefault();
        setSpotlightOpen(false);
        if (e.shiftKey) {
          setPickerOpen(true);
        } else {
          void instantCreate();
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
        onNewWorkspace={() => void instantCreate()}
        onNewWorkspaceFrom={() => setPickerOpen(true)}
      />
      <NewWorkspaceFromDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        defaultProjectId={contextProject?.id}
      />
    </>
  );
}
