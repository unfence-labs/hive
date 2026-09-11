import { Button } from "@/components/ui/button";
import {
  checkForUpdatesNow,
  installCurrentUpdate,
  shouldCheckForUpdates,
  useDesktopUpdateState,
} from "@/hooks/useDesktopUpdate";

/** Shared by Settings and the compatibility gate; the coordinator owns all actions. */
export function UpdateControls() {
  const update = useDesktopUpdateState();
  if (!shouldCheckForUpdates())
    return (
      <p className="text-xs text-muted-foreground">
        Update checks run in installed builds only.
      </p>
    );

  switch (update.phase) {
    case "checking":
      return <p role="status">Checking for updates…</p>;
    case "preparing":
      return <p role="status">Preparing update…</p>;
    case "downloading":
      return (
        <p role="status">
          Downloading {update.version}…
          {update.percent !== null ? ` ${update.percent}%` : ""}
        </p>
      );
    case "updatingServer":
      return <p role="status">Updating server… {update.step}</p>;
    case "verifying":
      return <p role="status">Waiting for the updated server…</p>;
    case "installing":
      return <p role="status">Installing {update.version} and restarting…</p>;
    case "input":
      return <p role="status">Waiting for your input…</p>;
    case "available":
      return (
        <div className="space-y-3">
          <p>Version {update.version} is available.</p>
          <Button size="sm" onClick={installCurrentUpdate}>
            Update Hive
          </Button>
        </div>
      );
    case "resume":
      return (
        <div className="space-y-3">
          <p>Update to {update.version} is unfinished.</p>
          <Button size="sm" onClick={installCurrentUpdate}>
            Resume update
          </Button>
        </div>
      );
    case "failed":
      return (
        <div className="space-y-3">
          <p role="alert" className="text-destructive">
            Update failed: {update.error}
          </p>
          <Button size="sm" onClick={installCurrentUpdate}>
            Retry
          </Button>
        </div>
      );
    default:
      return (
        <div className="space-y-3">
          {update.phase === "upToDate" && <p>You're on the latest version.</p>}
          {update.phase === "completed" && <p>Hive is up to date.</p>}
          {update.phase === "checkFailed" && (
            <p role="alert" className="text-destructive">
              Update check failed: {update.error}
            </p>
          )}
          <Button size="sm" variant="outline" onClick={checkForUpdatesNow}>
            Check for updates
          </Button>
        </div>
      );
  }
}
