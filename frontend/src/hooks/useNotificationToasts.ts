import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { sileo } from "sileo";
import { wsTransport } from "@/lib/ws-transport";
import { formatElapsed } from "@/lib/time";
import { getLocalToastsEnabled } from "@/pages/settings/NotificationSettings";
import { setSavedSession } from "@/hooks/useConversation";
import type { Project, Workspace } from "@/types";

export function useNotificationToasts(projects: Project[]): void {
  const location = useLocation();
  const navigate = useNavigate();
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  const locationRef = useRef(location.pathname);
  locationRef.current = location.pathname;

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    return wsTransport.onGlobalMessage((workspaceId, msg) => {
      if (!getLocalToastsEnabled()) return;

      // Suppress if user is currently viewing this workspace
      const match = locationRef.current.match(/^\/workspaces\/([^/]+)/);
      if (match?.[1] === workspaceId) return;

      // Resolve project name + branch for the toast title
      let label = workspaceId.slice(0, 8);
      for (const p of projectsRef.current) {
        const w = (p.workspaces ?? []).find((w: Workspace) => w.id === workspaceId);
        if (w) {
          const branch = w.branch?.replace(/^workspace\//, "") ?? w.name;
          label = `${p.name} · ${branch}`;
          break;
        }
      }

      const goToWorkspace = (sessionId?: string) => () => {
        if (sessionId) setSavedSession(workspaceId, sessionId);
        navigateRef.current(`/workspaces/${workspaceId}`);
      };

      if (msg.type === "done" && msg.sessionId) {
        const duration = msg.durationMs ? ` in ${formatElapsed(msg.durationMs)}` : "";
        sileo.success({
          title: label,
          description: `Turn complete${duration}`,
          button: { title: "View", onClick: goToWorkspace(msg.sessionId) },
        });
      } else if (msg.type === "cancelled" && !msg.userInitiated && msg.sessionId) {
        sileo.error({
          title: label,
          description: msg.errorDetail ?? "Agent failed",
          button: { title: "View", onClick: goToWorkspace(msg.sessionId) },
        });
      } else if (msg.type === "error") {
        sileo.error({
          title: label,
          description: msg.message,
          button: { title: "View", onClick: goToWorkspace(msg.sessionId) },
        });
      } else if (msg.type === "tool_input_required" && msg.sessionId) {
        const isPlan = msg.toolName === "ExitPlanMode";
        sileo.warning({
          title: label,
          description: isPlan ? "Plan ready for review" : "Agent needs input",
          button: { title: isPlan ? "Review" : "Respond", onClick: goToWorkspace(msg.sessionId) },
        });
      }
    });
  }, []);
}
