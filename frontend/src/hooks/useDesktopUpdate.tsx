import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { isDesktopShell } from "@/lib/is-desktop";
import { TOAST_DURATIONS } from "@/lib/toast-config";
import { HiveToast, type HiveToastVariant } from "@/components/ui/toaster";

/** The update handle returned by the updater plugin, minus the "no update" case. */
type Update = NonNullable<Awaited<ReturnType<typeof import("@tauri-apps/plugin-updater").check>>>;

/** One toast for the whole flow: available → downloading → installing → failed. */
const UPDATE_TOAST_ID = "hive-app-update";
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/**
 * Update checks only make sense for an installed desktop build: the web app is
 * served fresh on every load, and a dev build runs off the Vite server with no
 * installer to replace. Exported so tests can drive the gate.
 */
export function shouldCheckForUpdates(): boolean {
  return isDesktopShell() && import.meta.env.PROD;
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
        onClose={() => toast.dismiss(id)}
      />
    ),
    {
      id: UPDATE_TOAST_ID,
      duration: args.duration,
      onDismiss: args.onDismiss,
    },
  );
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 120 ? `${message.slice(0, 117)}…` : message;
}

/**
 * Watches for desktop releases and offers the install as a sticky toast.
 *
 * The toast is the only surface: a failed background check is the normal state
 * of an offline app, so it never reaches the user. Acting on the toast
 * downloads the installer in place, then relaunches into the new version.
 */
export function useDesktopUpdate(): void {
  const dismissedVersionRef = useRef<string | null>(null);
  const checkingRef = useRef(false);
  const installingRef = useRef(false);

  useEffect(() => {
    if (!shouldCheckForUpdates()) return;

    let active = true;

    /** Re-renders the sticky toast in place; no action while it runs. */
    const showProgress = (description: string) => {
      showUpdateToast({
        variant: "success",
        status: "UPDATE",
        description,
        duration: TOAST_DURATIONS.actionRequired,
      });
    };

    const install = async (update: Update) => {
      if (installingRef.current) return;
      installingRef.current = true;
      showProgress("Downloading update…");

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
            showProgress(`Downloading update… ${percent}%`);
          } else if (event.event === "Finished") {
            showProgress("Installing update…");
          }
        });

        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      } catch (error) {
        console.warn("Failed to install update:", error);
        installingRef.current = false;
        showUpdateToast({
          variant: "error",
          status: "FAILED",
          description: `Update failed: ${describeError(error)}`,
          actionLabel: "Retry",
          duration: TOAST_DURATIONS.error,
          onAction: () => void install(update),
        });
      }
    };

    const runCheck = async () => {
      // An install in flight owns the toast; a new check must not steal it.
      if (checkingRef.current || installingRef.current) return;
      checkingRef.current = true;

      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (!active || !update) return;
        if (dismissedVersionRef.current === update.version) return;
        showUpdateToast({
          variant: "success",
          status: "UPDATE",
          description: `Version ${update.version} is available`,
          actionLabel: "Restart & update",
          duration: TOAST_DURATIONS.actionRequired,
          onAction: () => void install(update),
          // Closing it answers "not this version"; a later release asks again.
          onDismiss: () => {
            dismissedVersionRef.current = update.version;
          },
        });
      } catch (error) {
        console.warn("Update check failed:", error);
      } finally {
        checkingRef.current = false;
      }
    };

    void runCheck();
    const timer = window.setInterval(() => void runCheck(), CHECK_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);
}
