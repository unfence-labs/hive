import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HiveToast } from "@/components/ui/toaster";
import { reconnectActivePtyTerminals } from "@/lib/pty-terminal";
import { reloadHive } from "@/lib/reload-hive";
import { TOAST_DURATIONS } from "@/lib/toast-config";
import { wsTransport } from "@/lib/ws-transport";
import { prefetchModelCatalog } from "@/hooks/useModels";

export const FULL_RESYNC_AFTER_MS = 5 * 60 * 1000;
export const CLOCK_CHECK_INTERVAL_MS = 30 * 1000;
export const RESYNC_TIMEOUT_MS = 10 * 1000;

function showSyncFailureToast() {
  toast.custom(
    (id) => (
      <HiveToast
        variant="error"
        title="Hive"
        status="Sync incomplete"
        description="Hive will keep trying to reconnect."
        actionLabel="Reload Hive"
        onAction={reloadHive}
        onClose={() => toast.dismiss(id)}
      />
    ),
    { duration: TOAST_DURATIONS.error },
  );
}

export function useAppResync(): boolean {
  const queryClient = useQueryClient();
  const [isResyncing, setIsResyncing] = useState(false);
  const inactiveSinceRef = useRef<number | null>(null);
  const lastClockCheckRef = useRef(Date.now());
  const resyncRef = useRef<Promise<void> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const runFullResync = useCallback(() => {
    if (resyncRef.current) return resyncRef.current;

    const abortController = new AbortController();
    abortRef.current = abortController;
    setIsResyncing(true);

    const timeoutId = window.setTimeout(() => {
      abortController.abort(new DOMException("Hive sync timed out.", "TimeoutError"));
    }, RESYNC_TIMEOUT_MS);

    const abortPromise = new Promise<never>((_, reject) => {
      abortController.signal.addEventListener(
        "abort",
        () => reject(abortController.signal.reason),
        { once: true },
      );
    });

    void queryClient
      .refetchQueries({ type: "active" }, { throwOnError: true })
      .catch((error) => {
        console.warn("[app-resync] Failed to refresh active queries:", error);
      });

    queryClient.removeQueries({ type: "inactive" });

    const operation = Promise.race([
      wsTransport.requestFullResync(abortController.signal),
      abortPromise,
    ]).then(
      () => {
        void Promise.resolve()
          .then(() => reconnectActivePtyTerminals())
          .catch((error) => {
            console.warn("[app-resync] Failed to reconnect PTY terminals:", error);
          });
        void import("@/components/BrowserPanel")
          .then(({ reconnectActiveBrowserStreams }) => {
            reconnectActiveBrowserStreams();
          })
          .catch((error) => {
            console.warn("[app-resync] Failed to reconnect browser streams:", error);
          });
        // Inactive queries were cleared above, so warm the app-level catalog
        // again without holding the hub resync open.
        void Promise.resolve()
          .then(() => prefetchModelCatalog(queryClient))
          .catch((error) => {
            console.warn("[app-resync] Failed to prefetch the model catalog:", error);
          });
      },
      (error) => {
        if (!mountedRef.current) return;
        console.warn("[app-resync] Hub resync failed:", error);
        showSyncFailureToast();
      },
    )
      .finally(() => {
        window.clearTimeout(timeoutId);
        if (abortRef.current === abortController) abortRef.current = null;
        if (resyncRef.current === operation) resyncRef.current = null;
        if (mountedRef.current) setIsResyncing(false);
      });

    resyncRef.current = operation;
    return operation;
  }, [queryClient]);

  useEffect(() => {
    mountedRef.current = true;

    const markInactive = () => {
      inactiveSinceRef.current ??= Date.now();
    };

    const recoverFromInactivity = () => {
      if (document.visibilityState === "hidden") return;
      const inactiveSince = inactiveSinceRef.current;
      if (inactiveSince === null) return;
      inactiveSinceRef.current = null;

      if (Date.now() - inactiveSince >= FULL_RESYNC_AFTER_MS) {
        void runFullResync();
      } else {
        wsTransport.probeLiveness();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        markInactive();
      } else {
        recoverFromInactivity();
      }
    };

    const handleOnline = () => {
      if (document.visibilityState === "hidden" || inactiveSinceRef.current !== null) return;
      wsTransport.probeLiveness();
    };

    const clockCheckId = window.setInterval(() => {
      const now = Date.now();
      const gap = now - lastClockCheckRef.current;
      lastClockCheckRef.current = now;
      if (gap < FULL_RESYNC_AFTER_MS) return;

      if (document.visibilityState === "hidden" || inactiveSinceRef.current !== null) {
        markInactive();
        return;
      }
      void runFullResync();
    }, CLOCK_CHECK_INTERVAL_MS);

    window.addEventListener("blur", markInactive);
    window.addEventListener("focus", recoverFromInactivity);
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      mountedRef.current = false;
      abortRef.current?.abort(new DOMException("Hive sync stopped.", "AbortError"));
      window.clearInterval(clockCheckId);
      window.removeEventListener("blur", markInactive);
      window.removeEventListener("focus", recoverFromInactivity);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [runFullResync]);

  return isResyncing;
}
