import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { sileo } from "sileo";
import { wsTransport } from "@/lib/ws-transport";
import { formatElapsed } from "@/lib/time";
import { getLocalToastsEnabled } from "@/pages/settings/NotificationSettings";
import type { Project, Workspace } from "@/types";

export function useNotificationToasts(projects: Project[]): void {
  const location = useLocation();
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  // Keep location in a ref so the WS listener always sees the latest value
  // without re-subscribing on every navigation.
  const locationRef = useRef(location.pathname);
  locationRef.current = location.pathname;

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

      if (msg.type === "done" && msg.sessionId) {
        const duration = msg.durationMs ? ` in ${formatElapsed(msg.durationMs)}` : "";
        sileo.success({ title: label, description: `Turn complete${duration}` });
      } else if (msg.type === "cancelled" && !msg.userInitiated && msg.sessionId) {
        sileo.error({
          title: label,
          description: msg.errorDetail ?? "Agent failed",
        });
      } else if (msg.type === "error") {
        sileo.error({ title: label, description: msg.message });
      }
    });
  }, []);
}
