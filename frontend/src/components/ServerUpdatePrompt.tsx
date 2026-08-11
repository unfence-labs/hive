import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { HiveToast } from "@/components/ui/toaster";
import { TOAST_DURATIONS } from "@/lib/toast-config";
import { api } from "@/hooks/useApi";
import { useAppVersion } from "@/hooks/useAppVersion";
import { useConnection } from "@/hooks/useConnection";
import { isDesktopShell } from "@/lib/is-desktop";
import {
  markServerUpdatePrompted,
  shouldOfferServerUpdate,
  shouldPromptServerUpdate,
  type ServerVersionResponse,
} from "@/lib/server-update";

const SERVER_UPDATE_TOAST_ID = "hive-server-update";

/**
 * Nudges once per launch when the server is not on the app's version — the
 * ordinary state right after a desktop auto-update, since the app must update
 * first (its bundled provisioner installs its own version). The action only navigates:
 * the update itself runs from Settings > Updates, which can host the dialogs
 * the run may need.
 */
export function ServerUpdatePrompt() {
  const navigate = useNavigate();
  const { connection } = useConnection();
  const appVersion = useAppVersion();
  const enabled = isDesktopShell() && Boolean(connection);
  const serverQuery = useQuery({
    queryKey: ["server", "version"],
    queryFn: () => api.get<ServerVersionResponse>("/api/server/version"),
    enabled,
  });
  const server = serverQuery.data ?? null;

  useEffect(() => {
    if (!enabled || server === null || !shouldOfferServerUpdate(appVersion, server)) return;
    if (!shouldPromptServerUpdate()) return;
    markServerUpdatePrompted();
    toast.custom(
      (id) => (
        <HiveToast
          variant="success"
          title="Hive"
          status="SERVER"
          description={`The server is on ${server.version}; the app is on ${appVersion}`}
          actionLabel="Review"
          onAction={() => {
            toast.dismiss(id);
            navigate("/settings/updates");
          }}
          onClose={() => toast.dismiss(id)}
        />
      ),
      { id: SERVER_UPDATE_TOAST_ID, duration: TOAST_DURATIONS.actionRequired },
    );
  }, [enabled, appVersion, server, navigate]);

  return null;
}
