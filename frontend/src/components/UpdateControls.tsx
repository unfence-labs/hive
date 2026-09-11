import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  checkForUpdatesNow,
  installCurrentUpdate,
  shouldCheckForUpdates,
  useDesktopUpdateState,
} from "@/hooks/useDesktopUpdate";

/** Phases the coordinator drives on its own: no action is offered while they run. */
const PROGRESS_PHASES = new Set([
  "checking",
  "preparing",
  "downloading",
  "updatingServer",
  "verifying",
  "installing",
  "input",
]);

/**
 * The heading action of the app update section, withdrawn whenever a re-check
 * cannot answer anything new: a release is already found, or a run is in
 * flight and owns the section body below.
 */
export function UpdateCheckAction() {
  const update = useDesktopUpdateState();
  if (!shouldCheckForUpdates()) return null;
  if (PROGRESS_PHASES.has(update.phase)) return null;
  if (update.phase === "available" || update.phase === "resume") return null;
  if (update.phase === "failed") return null;
  return (
    <Button size="sm" variant="outline" onClick={checkForUpdatesNow}>
      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
      Check for updates
    </Button>
  );
}

/** Body of the app update section, shared by Settings and the compatibility gate. */
export function UpdateStatus() {
  const update = useDesktopUpdateState();
  if (!shouldCheckForUpdates())
    return <Note>Update checks run in installed builds only.</Note>;

  switch (update.phase) {
    case "checking":
      return <Progress>Checking for updates…</Progress>;
    case "preparing":
      return <Progress>Preparing update…</Progress>;
    case "downloading":
      return (
        <Progress>
          Downloading {update.version}…
          {update.percent !== null ? ` ${update.percent}%` : ""}
        </Progress>
      );
    case "updatingServer":
      return <Progress>{update.step}</Progress>;
    case "verifying":
      return <Progress>Waiting for the updated server…</Progress>;
    case "installing":
      return <Progress>Installing {update.version} and restarting…</Progress>;
    case "input":
      return <Progress>Waiting for your input…</Progress>;
    case "available":
      return (
        <ActionRow
          message={`Version ${update.version} is available.`}
          label="Update Hive"
        />
      );
    case "resume":
      return (
        <ActionRow
          message={`Update to ${update.version} is unfinished.`}
          label="Resume update"
        />
      );
    case "failed":
      return (
        <ActionRow
          message={`Update failed: ${update.error}`}
          label="Retry"
          variant="outline"
          destructive
        />
      );
    case "checkFailed":
      return (
        <Note role="alert" destructive>
          Update check failed: {update.error}
        </Note>
      );
    case "upToDate":
    case "completed":
      return <Note>You're on the latest version.</Note>;
    default:
      return null;
  }
}

function Note({
  children,
  role,
  destructive = false,
}: {
  children: React.ReactNode;
  role?: string;
  destructive?: boolean;
}) {
  return (
    <p
      role={role}
      className={cn(
        "mt-3 text-xs",
        destructive ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {children}
    </p>
  );
}

function Progress({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
      {children}
    </p>
  );
}

/** A message and the single action that answers it, on one row. */
function ActionRow({
  message,
  label,
  variant,
  destructive = false,
}: {
  message: string;
  label: string;
  variant?: "outline";
  destructive?: boolean;
}) {
  return (
    <div className="mt-3 flex items-center justify-between gap-3">
      <p
        role={destructive ? "alert" : undefined}
        className={cn("text-xs", destructive ? "text-destructive" : "text-foreground")}
      >
        {message}
      </p>
      <Button
        size="sm"
        variant={variant}
        className="shrink-0"
        onClick={installCurrentUpdate}
      >
        {label}
      </Button>
    </div>
  );
}
