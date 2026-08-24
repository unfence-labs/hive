import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLOCK_CHECK_INTERVAL_MS,
  FULL_RESYNC_AFTER_MS,
  RESYNC_TIMEOUT_MS,
  useAppResync,
} from "@/hooks/useAppResync";
import { createWrapper } from "../test-utils";

const mocks = vi.hoisted(() => ({
  probeLiveness: vi.fn(),
  reconnectActiveBrowserStreams: vi.fn(),
  reconnectActivePtyTerminals: vi.fn(),
  reloadHive: vi.fn(),
  requestFullResync: vi.fn<(_signal?: AbortSignal) => Promise<void>>(),
  toastCustom: vi.fn(),
}));

vi.mock("@/lib/ws-transport", () => ({
  wsTransport: {
    probeLiveness: mocks.probeLiveness,
    requestFullResync: mocks.requestFullResync,
  },
}));

vi.mock("@/components/BrowserPanel", () => ({
  reconnectActiveBrowserStreams: mocks.reconnectActiveBrowserStreams,
}));

vi.mock("@/lib/pty-terminal", () => ({
  reconnectActivePtyTerminals: mocks.reconnectActivePtyTerminals,
}));

vi.mock("@/lib/reload-hive", () => ({ reloadHive: mocks.reloadHive }));
vi.mock("sonner", () => ({ toast: { custom: mocks.toastCustom, dismiss: vi.fn() } }));

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}

describe("useAppResync", () => {
  let visibilityState: DocumentVisibilityState;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
    vi.clearAllMocks();
    visibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilityState,
    });
    mocks.requestFullResync.mockResolvedValue();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("only probes liveness after a short absence", () => {
    const { wrapper } = createWrapper();
    renderHook(() => useAppResync(), { wrapper });

    act(() => window.dispatchEvent(new Event("blur")));
    act(() => vi.advanceTimersByTime(FULL_RESYNC_AFTER_MS - 1));
    act(() => window.dispatchEvent(new Event("focus")));

    expect(mocks.probeLiveness).toHaveBeenCalledTimes(1);
    expect(mocks.requestFullResync).not.toHaveBeenCalled();
  });

  it("waits for foreground before reacting to network recovery", () => {
    const { wrapper } = createWrapper();
    renderHook(() => useAppResync(), { wrapper });

    act(() => window.dispatchEvent(new Event("blur")));
    act(() => window.dispatchEvent(new Event("online")));
    expect(mocks.probeLiveness).not.toHaveBeenCalled();

    act(() => window.dispatchEvent(new Event("focus")));
    expect(mocks.probeLiveness).toHaveBeenCalledTimes(1);
  });

  it("runs one complete resync after a long absence", async () => {
    const pending = deferred();
    mocks.requestFullResync.mockReturnValue(pending.promise);
    const { queryClient, wrapper } = createWrapper();
    const refetch = vi.spyOn(queryClient, "refetchQueries").mockResolvedValue();
    const remove = vi.spyOn(queryClient, "removeQueries");
    const { result } = renderHook(() => useAppResync(), { wrapper });

    act(() => window.dispatchEvent(new Event("blur")));
    act(() => vi.advanceTimersByTime(FULL_RESYNC_AFTER_MS));
    act(() => window.dispatchEvent(new Event("focus")));
    await act(async () => Promise.resolve());

    expect(result.current).toBe(true);
    expect(mocks.requestFullResync).toHaveBeenCalledTimes(1);
    expect(mocks.reconnectActivePtyTerminals).not.toHaveBeenCalled();
    expect(mocks.reconnectActiveBrowserStreams).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith({ type: "inactive" });
    expect(refetch).toHaveBeenCalledWith({ type: "active" }, { throwOnError: true });

    await act(async () => pending.resolve());
    expect(result.current).toBe(false);
    expect(mocks.reconnectActivePtyTerminals).toHaveBeenCalledTimes(1);
    expect(mocks.reconnectActiveBrowserStreams).toHaveBeenCalledTimes(1);
    expect(mocks.toastCustom).not.toHaveBeenCalled();
  });

  it("detects a system sleep from a clock gap while active", () => {
    const pending = deferred();
    mocks.requestFullResync.mockReturnValue(pending.promise);
    const { wrapper } = createWrapper();
    renderHook(() => useAppResync(), { wrapper });

    vi.setSystemTime(Date.now() + FULL_RESYNC_AFTER_MS);
    act(() => vi.advanceTimersByTime(CLOCK_CHECK_INTERVAL_MS));

    expect(mocks.requestFullResync).toHaveBeenCalledTimes(1);
  });

  it("deduplicates overlapping recovery signals", () => {
    const pending = deferred();
    mocks.requestFullResync.mockReturnValue(pending.promise);
    const { wrapper } = createWrapper();
    renderHook(() => useAppResync(), { wrapper });

    act(() => window.dispatchEvent(new Event("blur")));
    act(() => vi.advanceTimersByTime(FULL_RESYNC_AFTER_MS));
    act(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("focus"));
    });
    vi.setSystemTime(Date.now() + FULL_RESYNC_AFTER_MS);
    act(() => vi.advanceTimersByTime(CLOCK_CHECK_INTERVAL_MS));

    expect(mocks.requestFullResync).toHaveBeenCalledTimes(1);
  });

  it("unblocks the app and offers manual reload after a timeout", async () => {
    let resyncSignal: AbortSignal | undefined;
    mocks.requestFullResync.mockImplementation((signal) => {
      resyncSignal = signal;
      return new Promise<void>(() => {});
    });
    const { queryClient, wrapper } = createWrapper();
    vi.spyOn(queryClient, "refetchQueries").mockResolvedValue();
    const cancel = vi.spyOn(queryClient, "cancelQueries").mockResolvedValue();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => useAppResync(), { wrapper });

    act(() => window.dispatchEvent(new Event("blur")));
    act(() => vi.advanceTimersByTime(FULL_RESYNC_AFTER_MS));
    act(() => window.dispatchEvent(new Event("focus")));
    expect(result.current).toBe(true);

    await act(async () => vi.advanceTimersByTime(RESYNC_TIMEOUT_MS));

    expect(resyncSignal?.aborted).toBe(true);
    expect(cancel).not.toHaveBeenCalled();
    expect(result.current).toBe(false);
    expect(mocks.reconnectActivePtyTerminals).not.toHaveBeenCalled();
    expect(mocks.reconnectActiveBrowserStreams).not.toHaveBeenCalled();
    expect(mocks.toastCustom).toHaveBeenCalledTimes(1);
  });

  it("completes the hub resync when an active REST query fails", async () => {
    const restRequest = deferred();
    const restError = new Error("REST unavailable");
    const { queryClient, wrapper } = createWrapper();
    vi.spyOn(queryClient, "refetchQueries").mockReturnValue(restRequest.promise);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => useAppResync(), { wrapper });

    act(() => window.dispatchEvent(new Event("blur")));
    act(() => vi.advanceTimersByTime(FULL_RESYNC_AFTER_MS));
    await act(async () => window.dispatchEvent(new Event("focus")));

    expect(result.current).toBe(false);
    expect(mocks.reconnectActivePtyTerminals).toHaveBeenCalledTimes(1);
    expect(mocks.reconnectActiveBrowserStreams).toHaveBeenCalledTimes(1);
    expect(mocks.toastCustom).not.toHaveBeenCalled();

    await act(async () => {
      restRequest.reject(restError);
      await Promise.resolve();
    });

    expect(warn).toHaveBeenCalledWith(
      "[app-resync] Failed to refresh active queries:",
      restError,
    );
    expect(mocks.toastCustom).not.toHaveBeenCalled();
  });

  it("offers manual reload when the hub resync is rejected", async () => {
    const hubError = new Error("Hub unavailable");
    mocks.requestFullResync.mockRejectedValue(hubError);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { queryClient, wrapper } = createWrapper();
    vi.spyOn(queryClient, "refetchQueries").mockResolvedValue();
    const { result } = renderHook(() => useAppResync(), { wrapper });

    act(() => window.dispatchEvent(new Event("blur")));
    act(() => vi.advanceTimersByTime(FULL_RESYNC_AFTER_MS));
    await act(async () => window.dispatchEvent(new Event("focus")));

    expect(result.current).toBe(false);
    expect(mocks.reconnectActivePtyTerminals).not.toHaveBeenCalled();
    expect(mocks.reconnectActiveBrowserStreams).not.toHaveBeenCalled();
    expect(mocks.toastCustom).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("[app-resync] Hub resync failed:", hubError);
  });

  it("removes recovery listeners on unmount", () => {
    const { wrapper } = createWrapper();
    const { unmount } = renderHook(() => useAppResync(), { wrapper });
    unmount();

    act(() => window.dispatchEvent(new Event("blur")));
    act(() => vi.advanceTimersByTime(FULL_RESYNC_AFTER_MS));
    act(() => window.dispatchEvent(new Event("focus")));

    expect(mocks.probeLiveness).not.toHaveBeenCalled();
    expect(mocks.requestFullResync).not.toHaveBeenCalled();
  });
});
