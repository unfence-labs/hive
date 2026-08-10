import { act, renderHook } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkForUpdatesNow,
  installCurrentUpdate,
  resetDesktopUpdateForTests,
  useDesktopUpdate,
  useDesktopUpdateState,
} from "@/hooks/useDesktopUpdate";
import { resetServerUpdate } from "@/lib/server-update";
import type { HiveToastProps } from "@/components/ui/toaster";

type CustomRender = (id: string | number) => ReactElement<HiveToastProps>;
type ToastOptions = { id?: string | number; duration?: number; onDismiss?: () => void };
type DownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
  custom: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));

vi.mock("sonner", () => ({
  // HiveToaster is never rendered in these tests, only HiveToast is read.
  Toaster: () => null,
  toast: {
    custom: mocks.custom,
    dismiss: mocks.dismiss,
  },
}));

function setDesktopShell(enabled: boolean) {
  const globals = window as unknown as Record<string, unknown>;
  if (enabled) globals.__TAURI_INTERNALS__ = {};
  else delete globals.__TAURI_INTERNALS__;
}

/** Drains the hook's dynamic imports and awaited plugin calls. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

async function renderUpdateHook() {
  const rendered = renderHook(() => useDesktopUpdate());
  await settle();
  return rendered;
}

/** Read the props of the most recently emitted <HiveToast> custom toast. */
function lastToast(): { props: HiveToastProps; options: ToastOptions } {
  const calls = mocks.custom.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const [render, options] = calls[calls.length - 1] as [CustomRender, ToastOptions];
  return { props: render(options?.id ?? "auto-id").props, options: options ?? {} };
}

function makeUpdate(version: string, downloadAndInstall = defaultDownload()) {
  return { version, downloadAndInstall, close: vi.fn(async () => {}) };
}

function defaultDownload() {
  return vi.fn(async (onEvent?: (event: DownloadEvent) => void) => {
    onEvent?.({ event: "Started", data: { contentLength: 100 } });
    onEvent?.({ event: "Progress", data: { chunkLength: 40 } });
    onEvent?.({ event: "Finished" });
  });
}

describe("useDesktopUpdate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    localStorage.clear();
    resetDesktopUpdateForTests();
    resetServerUpdate();
    setDesktopShell(true);
    // The hook only checks release builds; vitest runs in dev mode.
    vi.stubEnv("PROD", true);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.custom.mockImplementation((_render, options) => options?.id ?? "toast-custom");
    mocks.check.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    setDesktopShell(false);
  });

  it("does not check for updates outside the desktop shell", async () => {
    setDesktopShell(false);

    await renderUpdateHook();

    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.custom).not.toHaveBeenCalled();
  });

  it("does not check for updates in dev builds", async () => {
    vi.stubEnv("PROD", false);

    await renderUpdateHook();

    expect(mocks.check).not.toHaveBeenCalled();
  });

  it("stays silent when no update is available", async () => {
    await renderUpdateHook();

    expect(mocks.check).toHaveBeenCalledTimes(1);
    expect(mocks.custom).not.toHaveBeenCalled();
  });

  it("shows a sticky toast when an update is available", async () => {
    mocks.check.mockResolvedValue(makeUpdate("1.2.3"));

    await renderUpdateHook();

    const { props, options } = lastToast();
    expect(options.id).toBe("hive-app-update");
    expect(options.duration).toBe(Infinity);
    expect(props).toMatchObject({
      variant: "success",
      title: "Hive",
      status: "UPDATE",
      description: "Version 1.2.3 is available",
      actionLabel: "Restart & update",
    });
  });

  it("downloads, reports progress and relaunches when the action is clicked", async () => {
    const update = makeUpdate("1.2.3");
    mocks.check.mockResolvedValue(update);

    await renderUpdateHook();
    act(() => lastToast().props.onAction?.());
    await settle();

    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(mocks.relaunch).toHaveBeenCalledTimes(1);
    const descriptions = mocks.custom.mock.calls.map(
      ([render, options]) => (render as CustomRender)((options as ToastOptions)?.id ?? "").props.description,
    );
    expect(descriptions).toContain("Downloading update… 40%");
    expect(descriptions).toContain("Installing update…");
    // The progress toast drops its CTA so a second download cannot start.
    expect(lastToast().props.actionLabel).toBeUndefined();
  });

  it("shows a retryable error toast when the install fails", async () => {
    const update = makeUpdate(
      "1.2.3",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    mocks.check.mockResolvedValue(update);

    await renderUpdateHook();
    act(() => lastToast().props.onAction?.());
    await settle();

    expect(mocks.relaunch).not.toHaveBeenCalled();
    const { props, options } = lastToast();
    expect(options.duration).toBe(10000);
    expect(props).toMatchObject({
      variant: "error",
      status: "FAILED",
      description: "Update failed: network down",
      actionLabel: "Retry",
    });

    act(() => props.onAction?.());
    await settle();
    expect(update.downloadAndInstall).toHaveBeenCalledTimes(2);
  });

  it("swallows check failures without a toast", async () => {
    mocks.check.mockRejectedValue(new Error("no latest.json"));

    await renderUpdateHook();

    expect(mocks.custom).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it("does not re-show a dismissed version, but announces a newer one", async () => {
    const dismissedUpdate = makeUpdate("1.2.3");
    mocks.check.mockResolvedValue(dismissedUpdate);
    await renderUpdateHook();

    act(() => lastToast().props.onClose());
    expect(mocks.dismiss).toHaveBeenCalledWith("hive-app-update");
    // The handle stays open: the Updates page can still install a dismissed version.
    expect(dismissedUpdate.close).not.toHaveBeenCalled();
    mocks.custom.mockClear();

    await act(async () => {
      vi.advanceTimersByTime(CHECK_INTERVAL_MS);
    });
    await settle();
    expect(mocks.custom).not.toHaveBeenCalled();

    const newerUpdate = makeUpdate("1.3.0");
    mocks.check.mockResolvedValue(newerUpdate);
    await act(async () => {
      vi.advanceTimersByTime(CHECK_INTERVAL_MS);
    });
    await settle();
    expect(lastToast().props.description).toBe("Version 1.3.0 is available");
    expect(dismissedUpdate.close).toHaveBeenCalledTimes(1);
  });

  it("remembers a dismissed version after remounting", async () => {
    const firstUpdate = makeUpdate("1.2.3");
    mocks.check.mockResolvedValue(firstUpdate);
    const { unmount } = await renderUpdateHook();

    act(() => lastToast().props.onClose());
    unmount();
    mocks.custom.mockClear();

    const repeatedUpdate = makeUpdate("1.2.3");
    mocks.check.mockResolvedValue(repeatedUpdate);
    await renderUpdateHook();

    expect(mocks.custom).not.toHaveBeenCalled();
    // Kept open so the Updates page can still offer the dismissed install.
    expect(repeatedUpdate.close).not.toHaveBeenCalled();
  });

  it("releases the active update when the hook unmounts", async () => {
    const update = makeUpdate("1.2.3");
    mocks.check.mockResolvedValue(update);
    const { unmount } = await renderUpdateHook();

    unmount();

    expect(update.close).toHaveBeenCalledTimes(1);
  });

  it("releases the previous update when a later check replaces it", async () => {
    const firstUpdate = makeUpdate("1.2.3");
    const secondUpdate = makeUpdate("1.2.3");
    mocks.check.mockResolvedValueOnce(firstUpdate).mockResolvedValueOnce(secondUpdate);
    await renderUpdateHook();

    await act(async () => {
      vi.advanceTimersByTime(CHECK_INTERVAL_MS);
    });
    await settle();

    expect(firstUpdate.close).toHaveBeenCalledTimes(1);
    expect(secondUpdate.close).not.toHaveBeenCalled();
  });

  it("stops checking after unmount", async () => {
    const { unmount } = await renderUpdateHook();

    unmount();
    await act(async () => {
      vi.advanceTimersByTime(CHECK_INTERVAL_MS);
    });
    await settle();

    expect(mocks.check).toHaveBeenCalledTimes(1);
  });

  it("refuses to install while a server update is provisioning", async () => {
    const { runServerUpdate } = await import("@/lib/server-update");
    const update = makeUpdate("1.2.3");
    mocks.check.mockResolvedValue(update);
    await renderUpdateHook();

    // A provisioning run holds the SSH sidecar; relaunch() would kill it.
    const client = {
      listKeys: vi.fn(),
      testConnection: vi.fn(),
      trustHost: vi.fn(),
      preflight: vi.fn(),
      install: vi.fn(() => new Promise<void>(() => {})),
    };
    void runServerUpdate(client, { host: "203.0.113.10", keyPath: "/k" });

    act(() => lastToast().props.onAction?.());
    await settle();

    expect(update.downloadAndInstall).not.toHaveBeenCalled();
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });

  it("dismissing the toast keeps the update available to the Updates page", async () => {
    mocks.check.mockResolvedValue(makeUpdate("1.2.3"));
    const { result } = renderHook(() => {
      useDesktopUpdate();
      return useDesktopUpdateState();
    });
    await settle();

    act(() => lastToast().props.onClose());

    expect(result.current).toEqual({ phase: "available", version: "1.2.3" });
  });

  it("does not clobber an install started while a check was in flight", async () => {
    const installedUpdate = makeUpdate(
      "1.2.3",
      vi.fn(() => new Promise<void>(() => {})), // download never settles
    );
    mocks.check.mockResolvedValue(installedUpdate);
    const { result } = renderHook(() => {
      useDesktopUpdate();
      return useDesktopUpdateState();
    });
    await settle();

    let resolveCheck: (update: unknown) => void = () => {};
    mocks.check.mockReturnValue(new Promise((resolve) => (resolveCheck = resolve)));
    await act(async () => {
      vi.advanceTimersByTime(CHECK_INTERVAL_MS);
    });
    act(() => lastToast().props.onAction?.());
    await settle();

    const lateUpdate = makeUpdate("1.2.4");
    act(() => resolveCheck(lateUpdate));
    await settle();

    expect(result.current).toEqual({ phase: "downloading", version: "1.2.3", percent: null });
    expect(installedUpdate.close).not.toHaveBeenCalled();
    expect(lateUpdate.close).toHaveBeenCalledTimes(1);
  });

  it("keeps an offered update available when a later check fails", async () => {
    mocks.check.mockResolvedValue(makeUpdate("1.2.3"));
    const { result } = renderHook(() => {
      useDesktopUpdate();
      return useDesktopUpdateState();
    });
    await settle();

    mocks.check.mockRejectedValue(new Error("offline"));
    await act(async () => {
      vi.advanceTimersByTime(CHECK_INTERVAL_MS);
    });
    await settle();

    expect(result.current).toEqual({ phase: "available", version: "1.2.3" });
  });

  it("reflects a toast-driven install in the shared state", async () => {
    mocks.check.mockResolvedValue(makeUpdate("1.2.3"));
    const { result } = renderHook(() => {
      useDesktopUpdate();
      return useDesktopUpdateState();
    });
    await settle();

    act(() => lastToast().props.onAction?.());
    await settle();

    expect(result.current).toEqual({ phase: "installing", version: "1.2.3" });
  });
});

describe("manual checks from the Updates page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetDesktopUpdateForTests();
    resetServerUpdate();
    setDesktopShell(true);
    vi.stubEnv("PROD", true);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.custom.mockImplementation((_render, options) => options?.id ?? "toast-custom");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    setDesktopShell(false);
  });

  it("surfaces a dismissed version without a toast", async () => {
    localStorage.setItem("hive-dismissed-update-version", "1.2.3");
    mocks.check.mockResolvedValue(makeUpdate("1.2.3"));
    const { result } = renderHook(() => useDesktopUpdateState());

    act(() => checkForUpdatesNow());
    await settle();

    expect(result.current).toEqual({ phase: "available", version: "1.2.3" });
    expect(mocks.custom).not.toHaveBeenCalled();
  });

  it("reports up to date when there is no update", async () => {
    mocks.check.mockResolvedValue(null);
    const { result } = renderHook(() => useDesktopUpdateState());

    act(() => checkForUpdatesNow());
    await settle();

    expect(result.current).toEqual({ phase: "upToDate" });
  });

  it("reports a failed check", async () => {
    mocks.check.mockRejectedValue(new Error("no latest.json"));
    const { result } = renderHook(() => useDesktopUpdateState());

    act(() => checkForUpdatesNow());
    await settle();

    expect(result.current).toEqual({ phase: "checkFailed", error: "no latest.json" });
  });

  it("does not check outside installed desktop builds", async () => {
    vi.stubEnv("PROD", false);

    act(() => checkForUpdatesNow());
    await settle();

    expect(mocks.check).not.toHaveBeenCalled();
  });

  it("installs the update found by a manual check", async () => {
    const update = makeUpdate("1.2.3");
    mocks.check.mockResolvedValue(update);
    renderHook(() => useDesktopUpdateState());

    act(() => checkForUpdatesNow());
    await settle();
    act(() => installCurrentUpdate());
    await settle();

    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(mocks.relaunch).toHaveBeenCalledTimes(1);
  });
});
