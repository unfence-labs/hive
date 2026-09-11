import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsPanel, SettingsSection } from "@/components/settings/SettingsSection";
import { UpdateCheckAction, UpdateStatus } from "@/components/UpdateControls";
import { isDesktopShell } from "@/lib/is-desktop";
import type { ServerVersionResponse } from "@/lib/server-update";

/**
 * The one description of where the app and the server stand, shared by the
 * Updates settings page and the compatibility gate so a blocked app shows the
 * same two sections it shows once it is unblocked.
 */
export function UpdatePanel({
  appVersion,
  server,
  serverState,
  error,
  onRetry,
}: {
  appVersion: string | null;
  server: ServerVersionResponse | null;
  serverState: "checking" | "ready" | "unavailable";
  error?: string;
  /** Offered only where a failed check is the user's to retry. */
  onRetry?: () => void;
}) {
  return (
    <SettingsPanel>
      {isDesktopShell() && (
        <SettingsSection
          title="Hive"
          description={`Version ${appVersion ?? "—"}`}
          action={<UpdateCheckAction />}
        >
          <UpdateStatus />
        </SettingsSection>
      )}
      <SettingsSection
        title="Server"
        description={
          serverState === "unavailable"
            ? "Version unavailable"
            : `Version ${server?.version ?? "—"}`
        }
      >
        {serverState === "checking" && (
          <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            Checking the server…
          </p>
        )}
        {error && (
          <p role="alert" className="mt-3 text-xs text-destructive">
            {error}
          </p>
        )}
        {server?.updateMethod === "manual" && (
          <p className="mt-3 text-xs text-muted-foreground">
            This server was installed manually. Update it manually to the same
            version as the app.
          </p>
        )}
        {onRetry && (
          <div className="mt-3">
            <Button size="sm" variant="outline" onClick={onRetry}>
              Retry
            </Button>
          </div>
        )}
      </SettingsSection>
    </SettingsPanel>
  );
}
