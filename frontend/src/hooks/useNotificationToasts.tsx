import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast, type ExternalToast } from "sonner";
import { wsTransport } from "@/lib/ws-transport";
import { formatElapsed } from "@/lib/time";
import { TOAST_DURATIONS } from "@/lib/toast-config";
import { getLocalToastsEnabled } from "@/pages/settings/NotificationSettings";
import { setSavedSession } from "@/hooks/useConversation";
import { BRAIN_WORKSPACE_ID } from "@/lib/brain";
import { HiveToast, type HiveToastVariant } from "@/components/ui/toaster";
import type { Project, Workspace } from "@/types";

type ToastId = string | number;

const WORKSPACE_PATH_RE = /^\/workspaces\/([^/]+)/;
const ACTION_TOAST_PREFIX = "hive-action-toast";

function getOpenWorkspaceId(pathname: string): string | null {
  if (pathname === "/brain" || pathname.startsWith("/brain/")) return BRAIN_WORKSPACE_ID;
  return pathname.match(WORKSPACE_PATH_RE)?.[1] ?? null;
}

function workspacePath(workspaceId: string): string {
  return workspaceId === BRAIN_WORKSPACE_ID ? "/brain" : `/workspaces/${workspaceId}`;
}

function getActionToastKey(workspaceId: string, sessionId: string): string {
  return `${ACTION_TOAST_PREFIX}:${workspaceId}:${sessionId}`;
}

function dismissActionToast(actionToasts: Map<string, ToastId>, key: string) {
  const toastId = actionToasts.get(key);
  if (toastId === undefined) return;
  actionToasts.delete(key);
  toast.dismiss(toastId);
}

function dismissActionToastsForSession(actionToasts: Map<string, ToastId>, workspaceId: string, sessionId: string) {
  dismissActionToast(actionToasts, getActionToastKey(workspaceId, sessionId));
}

function dismissActionToastsForWorkspace(actionToasts: Map<string, ToastId>, workspaceId: string) {
  const prefix = `${ACTION_TOAST_PREFIX}:${workspaceId}:`;
  for (const key of actionToasts.keys()) {
    if (key.startsWith(prefix)) dismissActionToast(actionToasts, key);
  }
}

function showWorkspaceToast(args: {
  variant: HiveToastVariant;
  title: string;
  status: string;
  description: string;
  actionLabel: string;
  duration: number;
  id?: ToastId;
  onAction: () => void;
  onDismiss?: ExternalToast["onDismiss"];
}): ToastId {
  return toast.custom(
    (id) => (
      <HiveToast
        variant={args.variant}
        title={args.title}
        status={args.status}
        description={args.description}
        actionLabel={args.actionLabel}
        onAction={() => {
          args.onAction();
          toast.dismiss(id);
        }}
        onClose={() => toast.dismiss(id)}
      />
    ),
    {
      id: args.id,
      duration: args.duration,
      onDismiss: args.onDismiss,
    },
  );
}

export function useNotificationToasts(projects: Project[]): void {
  const location = useLocation();
  const navigate = useNavigate();
  const actionToastsRef = useRef(new Map<string, ToastId>());
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  const locationRef = useRef(location.pathname);
  locationRef.current = location.pathname;

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    return wsTransport.onGlobalMessage((workspaceId, msg) => {
      // The pending question was answered or dismissed (possibly on another
      // client), or a turn (re)started streaming — either way it is gone.
      if (msg.type === "tool_input_resolved") {
        dismissActionToastsForSession(actionToastsRef.current, workspaceId, msg.sessionId);
        return;
      }
      if (msg.type === "status") {
        if (msg.sessionId && msg.streaming) {
          dismissActionToastsForSession(actionToastsRef.current, workspaceId, msg.sessionId);
        }
        return;
      }

      const getToastContext = () => {
        const viewing = getOpenWorkspaceId(locationRef.current) === workspaceId;

        // Resolve project name + branch for the toast title
        let label = workspaceId === BRAIN_WORKSPACE_ID ? "Brain" : workspaceId.slice(0, 8);
        for (const p of projectsRef.current) {
          const w = (p.workspaces ?? []).find((w: Workspace) => w.id === workspaceId);
          if (w) {
            const branch = w.branch?.replace(/^workspace\//, "") ?? w.name;
            label = `${p.name} · ${branch}`;
            break;
          }
        }

        const go = (sessionId?: string) => {
          if (sessionId) setSavedSession(workspaceId, sessionId);
          navigateRef.current(workspacePath(workspaceId));
        };

        return { viewing, label, go };
      };

      if (msg.type === "done" && msg.sessionId) {
        // Turn paused on a blocking tool — the matching tool_input_required
        // event follows, so this is not a completion worth announcing.
        if (msg.pendingToolName) return;
        const sid = msg.sessionId;
        dismissActionToastsForSession(actionToastsRef.current, workspaceId, sid);
        if (!getLocalToastsEnabled()) return;
        const { viewing, label, go } = getToastContext();
        if (viewing) return;
        const duration = msg.durationMs ? ` in ${formatElapsed(msg.durationMs)}` : "";
        showWorkspaceToast({
          variant: "success",
          title: label,
          status: "Done",
          description: `Turn complete${duration}`,
          actionLabel: "View",
          duration: TOAST_DURATIONS.done,
          onAction: () => go(sid),
        });
      } else if (msg.type === "cancelled" && msg.sessionId) {
        const sid = msg.sessionId;
        dismissActionToastsForSession(actionToastsRef.current, workspaceId, sid);
        if (!getLocalToastsEnabled()) return;
        const { viewing, label, go } = getToastContext();
        if (msg.userInitiated || viewing) return;
        showWorkspaceToast({
          variant: "error",
          title: label,
          status: "Failed",
          description: msg.errorDetail ?? "Agent failed",
          actionLabel: "View",
          duration: TOAST_DURATIONS.error,
          onAction: () => go(sid),
        });
      } else if (msg.type === "error") {
        const sid = msg.sessionId;
        if (sid) {
          dismissActionToastsForSession(actionToastsRef.current, workspaceId, sid);
        } else {
          dismissActionToastsForWorkspace(actionToastsRef.current, workspaceId);
        }
        if (!getLocalToastsEnabled()) return;
        const { viewing, label, go } = getToastContext();
        if (viewing) return;
        showWorkspaceToast({
          variant: "error",
          title: label,
          status: "Error",
          description: msg.message,
          actionLabel: "View",
          duration: TOAST_DURATIONS.error,
          onAction: () => go(sid),
        });
      } else if (msg.type === "tool_input_required" && msg.sessionId) {
        if (!getLocalToastsEnabled()) return;
        const { label, go } = getToastContext();
        // Sticky until the question is resolved or the turn ends. Following
        // the CTA opens the response surface and dismisses the reminder.
        const sid = msg.sessionId;
        const isPlan = msg.toolName === "ExitPlanMode";
        const actionToastKey = getActionToastKey(workspaceId, sid);
        const toastId = showWorkspaceToast({
          id: actionToastKey,
          variant: "warning",
          title: label,
          status: isPlan ? "Plan" : "Input",
          description: isPlan ? "Plan ready for review" : "Agent needs input",
          actionLabel: isPlan ? "Review" : "Respond",
          duration: TOAST_DURATIONS.actionRequired,
          onAction: () => go(sid),
          onDismiss: () => {
            if (actionToastsRef.current.get(actionToastKey) === toastId) {
              actionToastsRef.current.delete(actionToastKey);
            }
          },
        });
        actionToastsRef.current.set(actionToastKey, toastId);
      }
    });
  }, []);
}
