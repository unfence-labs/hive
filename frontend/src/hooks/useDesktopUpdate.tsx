import { useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { isDesktopShell } from "@/lib/is-desktop";
import { serverUpdateInProgress } from "@/lib/server-update";
import { TOAST_DURATIONS } from "@/lib/toast-config";
import { HiveToast, type HiveToastVariant } from "@/components/ui/toaster";

/** The update handle returned by the updater plugin, minus the "no update" case. */
type Update = NonNullable<Awaited<ReturnType<typeof import("@tauri-apps/plugin-updater").check>>>;

/** One toast for the whole flow: available → downloading → installing → failed. */
const UPDATE_TOAST_ID = "hive-app-update";
const DISMISSED_UPDATE_VERSION_KEY = "hive-dismissed-update-version";
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/**
 * Update checks only make sense for an installed desktop build: the web app is
 * served fresh on every load, and a dev build runs off the Vite server with no
 * installer to replace. Exported so tests can drive the gate.
 */
export function shouldCheckForUpdates(): boolean {
  return isDesktopShell() && import.meta.env.PROD;
}

/**
 * One state machine shared by two surfaces: the sticky toast (passive channel,
 * mounted app-wide) and the Updates settings page (active channel). Both render
 * the same flow, so an install started from either is visible on both.
 */
export type DesktopUpdateState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "upToDate" }
  | { phase: "checkFailed"; error: string }
  | { phase: "available"; version: string }
  | { phase: "downloading"; version: string; percent: number | null }
  | { phase: "installing"; version: string }
  | { phase: "failed"; version: string; error: string };

let state: DesktopUpdateState = { phase: "idle" };
const listeners = new Set<() => void>();
let currentUpdate: Update | null = null;
let watcherActive = false;

function setState(next: DesktopUpdateState): void {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDesktopUpdateState(): DesktopUpdateState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Test-only: the module store outlives each test's mount. */
export function resetDesktopUpdateForTests(): void {
  state = { phase: "idle" };
  currentUpdate = null;
  watcherActive = false;
}

function showUpdateToast(args: {
  variant: HiveToastVariant;
  status: string;
  description: string;
  actionLabel?: string;
  duration: number;
  onAction?: () => void;
  onDismiss?: () => void;
}): void {
  toast.custom(
    (id) => (
      <HiveToast
        variant={args.variant}
        title="Hive"
        status={args.status}
        description={args.description}
        actionLabel={args.actionLabel}
        onAction={args.onAction}
        onClose={() => {
          args.onDismiss?.();
          toast.dismiss(id);
        }}
      />
    ),
    {
      id: UPDATE_TOAST_ID,
      duration: args.duration,
      onDismiss: args.onDismiss,
    },
  );
}

/** Re-renders the sticky toast in place; no action while it runs. */
function showProgressToast(description: string): void {
  showUpdateToast({
    variant: "success",
    status: "UPDATE",
    description,
    duration: TOAST_DURATIONS.actionRequired,
  });
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 120 ? `${message.slice(0, 117)}…` : message;
}

/** Read `state` fresh: async flows re-check it after every await. */
function installInProgress(): boolean {
  return state.phase === "downloading" || state.phase === "installing";
}

function releaseUpdate(update: Update): void {
  if (currentUpdate === update) currentUpdate = null;
  void update.close().catch((error) => console.warn("Failed to release update:", error));
}

async function install(update: Update): Promise<void> {
  // The install ends in relaunch(), which kills the SSH sidecar — never under
  // a provisioning run that is updating the server through it.
  if (installInProgress() || serverUpdateInProgress()) return;
  setState({ phase: "downloading", version: update.version, percent: null });
  showProgressToast("Downloading update…");

  try {
    let contentLength = 0;
    let downloaded = 0;
    let lastPercent = -1;
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        contentLength = event.data.contentLength ?? 0;
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        if (contentLength <= 0) return;
        const percent = Math.min(100, Math.round((downloaded / contentLength) * 100));
        if (percent === lastPercent) return;
        lastPercent = percent;
        setState({ phase: "downloading", version: update.version, percent });
        showProgressToast(`Downloading update… ${percent}%`);
      } else if (event.event === "Finished") {
        setState({ phase: "installing", version: update.version });
        showProgressToast("Installing update…");
      }
    });

    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (error) {
    console.warn("Failed to install update:", error);
    setState({ phase: "failed", version: update.version, error: describeError(error) });
    showUpdateToast({
      variant: "error",
      status: "FAILED",
      description: `Update failed: ${describeError(error)}`,
      actionLabel: "Retry",
      duration: TOAST_DURATIONS.error,
      onAction: () => void install(update),
    });
  }
}

/**
 * A manual check answers on the Updates page instead of toasting, and ignores
 * the dismissed version: it exists precisely to recover a dismissed update.
 */
async function runCheck(opts: { manual: boolean }): Promise<void> {
  if (state.phase === "checking" || installInProgress()) return;
  setState({ phase: "checking" });

  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    // An install may have started from a live toast while the check was in
    // flight; it owns the state and its handle must not be closed under it.
    if (installInProgress()) {
      if (update) releaseUpdate(update);
      return;
    }
    if (!update) {
      if (currentUpdate) releaseUpdate(currentUpdate);
      setState(opts.manual ? { phase: "upToDate" } : { phase: "idle" });
      return;
    }
    if (!opts.manual && !watcherActive) {
      releaseUpdate(update);
      setState({ phase: "idle" });
      return;
    }
    if (currentUpdate && currentUpdate !== update) releaseUpdate(currentUpdate);
    currentUpdate = update;
    setState({ phase: "available", version: update.version });

    if (opts.manual) return;
    const dismissed = window.localStorage.getItem(DISMISSED_UPDATE_VERSION_KEY);
    if (dismissed === update.version) return;
    showUpdateToast({
      variant: "success",
      status: "UPDATE",
      description: `Version ${update.version} is available`,
      actionLabel: "Restart & update",
      duration: TOAST_DURATIONS.actionRequired,
      onAction: () => void install(update),
      // Closing it answers "not this version": the toast stays away until a
      // later release, but the Updates page still offers the install.
      onDismiss: () => {
        window.localStorage.setItem(DISMISSED_UPDATE_VERSION_KEY, update.version);
      },
    });
  } catch (error) {
    console.warn("Update check failed:", error);
    if (installInProgress()) return;
    if (currentUpdate) {
      // A failed check (offline is normal) must not retract an offered update.
      setState({ phase: "available", version: currentUpdate.version });
      return;
    }
    setState(opts.manual ? { phase: "checkFailed", error: describeError(error) } : { phase: "idle" });
  }
}

export function checkForUpdatesNow(): void {
  if (!shouldCheckForUpdates()) return;
  void runCheck({ manual: true });
}

export function installCurrentUpdate(): void {
  if (currentUpdate) void install(currentUpdate);
}

/**
 * Watches for desktop releases and offers the install as a sticky toast.
 *
 * The toast is the only passive surface: a failed background check is the
 * normal state of an offline app, so it never reaches the user. Acting on the
 * toast downloads the installer in place, then relaunches into the new version.
 */
export function useDesktopUpdate(): void {
  useEffect(() => {
    if (!shouldCheckForUpdates()) return;

    watcherActive = true;
    void runCheck({ manual: false });
    const timer = window.setInterval(() => void runCheck({ manual: false }), CHECK_INTERVAL_MS);

    return () => {
      watcherActive = false;
      window.clearInterval(timer);
      if (currentUpdate && !installInProgress()) {
        releaseUpdate(currentUpdate);
        setState({ phase: "idle" });
      }
    };
  }, []);
}
