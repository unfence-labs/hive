import { QueryObserver } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  serverCompatibilityMatchesConnection,
  checkForUpdatesNow,
  compareVersions,
  desktopUpdateInProgress,
  dismissUpdateInput,
  installCurrentUpdate,
  refreshServerCompatibility,
  resetDesktopUpdateForTests,
  respondToUpdate,
  setUpdateBusyWorkspaces,
  useDesktopUpdate,
  useDesktopUpdateState,
  useServerCompatibility,
} from "@/hooks/useDesktopUpdate";
import { getConnection, replaceConnection } from "@/hooks/useConnection";
import { switchServer } from "@/lib/server-connection";
import { subscribeAppCommand } from "@/lib/app-commands";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  check: vi.fn(),
  download: vi.fn(),
  install: vi.fn(),
  close: vi.fn(),
  provision: vi.fn(),
  listKeys: vi.fn(),
  relaunch: vi.fn(),
  custom: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-updater", () => ({
  check: mocks.check,
  Update: class {
    version: string;
    constructor(metadata: { version: string }) {
      this.version = metadata.version;
    }
    download = mocks.download;
    install = mocks.install;
    close = mocks.close;
  },
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));
vi.mock("@/lib/provision-client", async (original) => ({
  ...(await original<typeof import("@/lib/provision-client")>()),
  createTauriProvisionClient: () => ({
    install: mocks.provision,
    listKeys: mocks.listKeys,
  }),
}));
vi.mock("sonner", () => ({
  Toaster: () => null,
  toast: { custom: mocks.custom, dismiss: vi.fn() },
}));
vi.mock("@/lib/ws-transport", () => ({
  wsTransport: {
    subscribe: () => () => {},
    getStatus: () => "disconnected",
    disconnectAll: vi.fn(),
  },
}));
const connection = {
  host: "server.test",
  port: 9420,
  authToken: "private-token",
  sshKeyPath: "/keys/id",
  adminUser: "admin",
};
let appVersion: string;
let serverVersion: string;
let updateMethod: "manual" | "provisioner";
let order: string[];
let fetchMock: ReturnType<typeof vi.fn>;

async function settle() {
  await act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
}
function store() {
  return renderHook(() => ({
    update: useDesktopUpdateState(),
    compatibility: useServerCompatibility(),
  }));
}
async function offer() {
  act(() => checkForUpdatesNow());
  await settle();
}
async function launch() {
  act(() => installCurrentUpdate());
  await settle();
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PROD", true);
  Object.assign(window, { __TAURI_INTERNALS__: {} });
  localStorage.clear();
  resetDesktopUpdateForTests(true);
  replaceConnection(connection);
  setUpdateBusyWorkspaces(0);
  appVersion = "0.1.4";
  serverVersion = "0.1.4";
  updateMethod = "provisioner";
  order = [];
  mocks.invoke.mockImplementation(async (command, args) =>
    command === "app_version" ? appVersion : { version: args.targetVersion },
  );
  mocks.check.mockResolvedValue({ version: "0.1.5", close: mocks.close });
  mocks.close.mockResolvedValue(undefined);
  mocks.download.mockImplementation(async () => {
    order.push("download");
  });
  mocks.install.mockImplementation(async () => {
    order.push("install");
  });
  mocks.relaunch.mockImplementation(async () => {
    order.push("relaunch");
  });
  mocks.provision.mockImplementation(async ({ options }) => {
    order.push("provision");
    serverVersion = options.targetVersion;
  });
  mocks.listKeys.mockResolvedValue([{ path: "/keys/picked", usable: true }]);
  fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    json: async () =>
      url.endsWith("/api/projects")
        ? []
        : { version: serverVersion, updateMethod },
  }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe("coupled updates", () => {

  it.each([
    ["0.1.4", "0.1.5-beta.1"],
    ["0.1.5-beta.1", "0.1.5-beta.2"],
    ["0.1.5-beta.2", "0.1.5"],
  ])("updates matching app/backend %s to explicitly offered %s", async (current, target) => {
    appVersion = serverVersion = current;
    mocks.check.mockResolvedValue({ version: target, close: mocks.close });
    await offer();
    await launch();
    expect(order).toEqual(["download", "provision", "install", "relaunch"]);
    expect(mocks.provision).toHaveBeenCalledWith(
      expect.objectContaining({ options: { update: true, targetVersion: target, expectedVersion: current } }),
      expect.any(Function),
    );
  });

  it("catches a stable client up to its beta backend without provisioning again", async () => {
    serverVersion = "0.1.5-beta.1";
    await refreshServerCompatibility();
    await launch();
    expect(order).toEqual(["download", "install", "relaunch"]);
    expect(mocks.invoke).toHaveBeenCalledWith("check_desktop_update", { targetVersion: serverVersion });
  });

  it("resumes an interrupted beta update after the backend already finished", async () => {
    serverVersion = "0.1.5-beta.1";
    localStorage.setItem("hive-pending-update", JSON.stringify({
      targetVersion: serverVersion, serverIdentity: "http://server.test:9420",
    }));
    const { result } = store();
    await refreshServerCompatibility();
    expect(result.current.update).toEqual({ phase: "resume", version: serverVersion });
    await launch();
    expect(order).toEqual(["download", "install", "relaunch"]);
  });

  it("downloads and verifies the exact desktop release before provisioning, then installs and relaunches", async () => {
    const { result } = store();
    await offer();
    await launch();
    expect(order).toEqual(["download", "provision", "install", "relaunch"]);
    expect(mocks.invoke).toHaveBeenCalledWith("check_desktop_update", {
      targetVersion: "0.1.5",
    });
    expect(mocks.provision).toHaveBeenCalledWith(
      expect.objectContaining({
        options: {
          update: true,
          targetVersion: "0.1.5",
          expectedVersion: "0.1.4",
        },
      }),
      expect.any(Function),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://server.test:9420/api/server/version",
      expect.objectContaining({
        headers: { Authorization: "Bearer private-token" },
      }),
    );
    expect(result.current.update.phase).toBe("resume"); // Relaunch is mocked; the old app is still running.
    const saved = JSON.parse(localStorage.getItem("hive-pending-update")!);
    expect(saved).toEqual({
      targetVersion: "0.1.5",
      serverIdentity: "http://server.test:9420",
    });
  });
  it("never modifies the backend if the desktop download or signature verification fails", async () => {
    mocks.download.mockRejectedValue(
      new Error("Signature verification failed"),
    );
    const { result } = store();
    await offer();
    await launch();
    expect(mocks.provision).not.toHaveBeenCalled();
    expect(mocks.install).not.toHaveBeenCalled();
    expect(result.current.update).toMatchObject({
      phase: "failed",
      error: "Signature verification failed",
    });
  });
  it("stops after backend failure and preserves its diagnostic", async () => {
    mocks.provision.mockRejectedValue({
      code: "UPDATE_FAILED",
      detail: "Rollback completed",
    });
    const { result } = store();
    await offer();
    await launch();
    expect(mocks.install).not.toHaveBeenCalled();
    expect(result.current.update).toMatchObject({
      phase: "failed",
      error: "Rollback completed",
    });
  });
  it("catches an old Mac up to the exact server version without changing the server", async () => {
    serverVersion = "0.1.5";
    await launch();
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith("check_desktop_update", {
      targetVersion: "0.1.5",
    });
    expect(order).toEqual(["download", "install", "relaunch"]);
  });
  it("updates only an older server to the installed Mac version", async () => {
    appVersion = "0.1.5";
    await launch();
    expect(order).toEqual(["provision"]);
    expect(localStorage.getItem("hive-pending-update")).toBeNull();
  });
  it("refuses backend regression when another Mac advances the server during download", async () => {
    mocks.download.mockImplementation(async () => {
      serverVersion = "0.1.6";
    });
    const { result } = store();
    await offer();
    await launch();
    expect(mocks.provision).not.toHaveBeenCalled();
    expect(mocks.install).not.toHaveBeenCalled();
    expect(result.current.update).toMatchObject({
      phase: "failed",
      error: expect.stringContaining("advanced"),
    });
    await launch();
    expect(mocks.invoke).toHaveBeenCalledWith("check_desktop_update", {
      targetVersion: "0.1.6",
    });
  });
  it("blocks switching servers throughout the download", async () => {
    let finish!: () => void;
    mocks.download.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await offer();
    await launch();
    expect(desktopUpdateInProgress()).toBe(true);
    await expect(
      switchServer({ ...connection, host: "other.test" }),
    ).rejects.toThrow("update is running");
    expect(getConnection()?.host).toBe("server.test");
    await act(async () => finish());
    await settle();
  });
  it("ignores stale results if the connection is replaced externally", async () => {
    let finish!: () => void;
    mocks.download.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = store();
    await offer();
    await launch();
    act(() => replaceConnection({ ...connection, host: "other.test" }));
    await act(async () => finish());
    await settle();
    expect(mocks.provision).not.toHaveBeenCalled();
    expect(mocks.install).not.toHaveBeenCalled();
    expect(result.current.update).toMatchObject({
      phase: "failed",
      error: expect.stringContaining("connection changed"),
    });
  });
  it("rechecks live work and uses the existing confirmation before interrupting agents", async () => {
    setUpdateBusyWorkspaces(2);
    const { result } = store();
    await offer();
    await launch();
    expect(result.current.update).toMatchObject({
      phase: "input",
      kind: "agents",
      busyWorkspaces: 2,
    });
    expect(mocks.provision).not.toHaveBeenCalled();
    act(() => respondToUpdate({ confirmAgents: true }));
    await settle();
    expect(mocks.provision).toHaveBeenCalledOnce();
  });
  it("collects a missing SSH key and a transient sudo password without redownloading", async () => {
    replaceConnection({ ...connection, sshKeyPath: undefined });
    mocks.provision.mockRejectedValueOnce({
      code: "SSH_PASSWORD_REQUIRED",
      detail: "Password required",
    });
    const { result } = store();
    await offer();
    await launch();
    expect(result.current.update).toMatchObject({
      phase: "input",
      kind: "key",
    });
    act(() => respondToUpdate({ keyPath: "/keys/picked" }));
    await settle();
    expect(result.current.update).toMatchObject({
      phase: "input",
      kind: "password",
    });
    act(() => respondToUpdate({ password: "secret-sudo" }));
    await settle();
    expect(mocks.download).toHaveBeenCalledOnce();
    expect(mocks.provision).toHaveBeenLastCalledWith(
      expect.objectContaining({ password: "secret-sudo" }),
      expect.any(Function),
    );
    expect(localStorage.getItem("hive-pending-update")).not.toContain(
      "secret-sudo",
    );
    expect(getConnection()?.sshKeyPath).toBe("/keys/picked");
  });
  it("allows dismissing a credential prompt and explicit retry", async () => {
    replaceConnection({ ...connection, sshKeyPath: undefined });
    const { result } = store();
    await offer();
    await launch();
    act(() => dismissUpdateInput());
    await settle();
    expect(result.current.update.phase).toBe("available");
    expect(localStorage.getItem("hive-pending-update")).toBeNull();
    expect(desktopUpdateInProgress()).toBe(false);
  });
  it("manual backends permit independent desktop updates and never provision", async () => {
    updateMethod = "manual";
    await offer();
    await launch();
    expect(order).toEqual(["download", "install", "relaunch"]);
    expect(serverVersion).toBe("0.1.4");
  });
  it("manual backend behind this Mac requires a manual update", async () => {
    updateMethod = "manual";
    appVersion = "0.1.5";
    const { result } = store();
    await launch();
    expect(order).toEqual([]);
    expect(result.current.update).toMatchObject({
      phase: "failed",
      error: expect.stringContaining("manually"),
    });
  });
  it("resumes after restart by verifying completed backend work and asking before installing the Mac", async () => {
    serverVersion = "0.1.5";
    localStorage.setItem(
      "hive-pending-update",
      JSON.stringify({
        targetVersion: "0.1.5",
        serverIdentity: "http://server.test:9420",
      }),
    );
    const { result } = store();
    await act(() => refreshServerCompatibility());
    expect(result.current.update).toEqual({
      phase: "resume",
      version: "0.1.5",
    });
    expect(order).toEqual([]);
    await launch();
    expect(order).toEqual(["download", "install", "relaunch"]);
  });
  it("clears the pending operation only after both installed versions match", async () => {
    appVersion = serverVersion = "0.1.5";
    localStorage.setItem(
      "hive-pending-update",
      JSON.stringify({
        targetVersion: "0.1.5",
        serverIdentity: "http://server.test:9420",
      }),
    );
    await refreshServerCompatibility();
    expect(localStorage.getItem("hive-pending-update")).toBeNull();
  });
  it("never automatically resumes an operation belonging to another server", async () => {
    localStorage.setItem(
      "hive-pending-update",
      JSON.stringify({
        targetVersion: "0.1.5",
        serverIdentity: "http://other.test:9420",
      }),
    );
    const { result } = store();
    await act(() => refreshServerCompatibility());
    expect(result.current.update.phase).toBe("idle");
  });
});

describe("update recovery and races", () => {
  it("cancels a fresh busy confirmation without blocking an otherwise matching app", async () => {
    setUpdateBusyWorkspaces(1);
    const { result } = store();
    await refreshServerCompatibility();
    await offer();
    await launch();
    act(() => dismissUpdateInput());
    await settle();
    expect(result.current.update).toEqual({
      phase: "available",
      version: "0.1.5",
    });
    expect(serverCompatibilityMatchesConnection(getConnection())).toBe(true);
    expect(localStorage.getItem("hive-pending-update")).toBeNull();
    expect(mocks.provision).not.toHaveBeenCalled();
  });
  it("keeps an interrupted update resumable when its confirmation is dismissed", async () => {
    setUpdateBusyWorkspaces(1);
    localStorage.setItem(
      "hive-pending-update",
      JSON.stringify({
        targetVersion: "0.1.5",
        serverIdentity: "http://server.test:9420",
      }),
    );
    const { result } = store();
    await refreshServerCompatibility();
    await launch();
    act(() => dismissUpdateInput());
    await settle();
    expect(result.current.update).toEqual({
      phase: "resume",
      version: "0.1.5",
    });
    expect(localStorage.getItem("hive-pending-update")).not.toBeNull();
  });

  it("retains the persisted target when another client advances the backend only partway", async () => {
    serverVersion = "0.1.5";
    localStorage.setItem(
      "hive-pending-update",
      JSON.stringify({
        targetVersion: "0.1.6",
        serverIdentity: "http://server.test:9420",
      }),
    );
    await refreshServerCompatibility();
    await launch();
    expect(mocks.invoke).toHaveBeenCalledWith("check_desktop_update", {
      targetVersion: "0.1.6",
    });
    expect(mocks.provision).toHaveBeenCalledWith(
      expect.objectContaining({
        options: {
          update: true,
          targetVersion: "0.1.6",
          expectedVersion: "0.1.5",
        },
      }),
      expect.any(Function),
    );
  });

  it("asks a generic interruption confirmation when live work is unknown at the initial gate", async () => {
    setUpdateBusyWorkspaces(null);
    const { result } = store();
    await offer();
    await launch();
    expect(result.current.update).toMatchObject({
      phase: "input",
      kind: "agents",
    });
    expect(result.current.update).not.toHaveProperty("busyWorkspaces", 0);
    expect(mocks.provision).not.toHaveBeenCalled();
    act(() => respondToUpdate({ confirmAgents: true }));
    await settle();
    expect(mocks.provision).toHaveBeenCalledOnce();
  });

  it("keeps the live busy count when the progress gate unmounts the workspace bridge", async () => {
    setUpdateBusyWorkspaces(3);
    mocks.download.mockImplementation(async () => {
      setUpdateBusyWorkspaces(null);
    });
    const { result } = store();
    await offer();
    await launch();
    expect(result.current.update).toMatchObject({
      phase: "input",
      kind: "agents",
      busyWorkspaces: 3,
    });
    act(() => dismissUpdateInput());
    await settle();
  });
  it("keeps a managed mismatch target instead of advertising the newest unrelated release", async () => {
    serverVersion = "0.1.5";
    mocks.check.mockResolvedValue({ version: "0.1.6", close: mocks.close });
    const { result } = renderHook(() => {
      useDesktopUpdate();
      return useDesktopUpdateState();
    });
    await settle();
    expect(result.current).toEqual({ phase: "available", version: "0.1.5" });
    expect(mocks.check).not.toHaveBeenCalled();
  });
  it("does not overwrite a mismatch discovered during a latest-release check", async () => {
    let finish!: (value: unknown) => void;
    mocks.check.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = store();
    await offer();
    serverVersion = "0.1.5";
    await act(() => refreshServerCompatibility());
    await act(async () => finish({ version: "0.1.6", close: mocks.close }));
    await settle();
    expect(result.current.update).toEqual({
      phase: "available",
      version: "0.1.5",
    });
    expect(mocks.custom).not.toHaveBeenCalled();
  });
  it("preserves an actionable failure through a compatibility refresh", async () => {
    mocks.download.mockRejectedValue(new Error("Signature mismatch"));
    const { result } = store();
    await offer();
    await launch();
    await act(() => refreshServerCompatibility());
    expect(result.current.update).toMatchObject({
      phase: "failed",
      error: "Signature mismatch",
    });
  });
  it("leaves manual guidance after an independently updated Mac restarts", async () => {
    appVersion = "0.1.5";
    updateMethod = "manual";
    localStorage.setItem(
      "hive-pending-update",
      JSON.stringify({
        targetVersion: "0.1.5",
        serverIdentity: "http://server.test:9420",
      }),
    );
    const { result } = store();
    await act(() => refreshServerCompatibility());
    expect(result.current.update.phase).toBe("idle");
    mocks.check.mockResolvedValue({ version: "0.1.6", close: mocks.close });
    await offer();
    await launch();
    expect(mocks.invoke).toHaveBeenCalledWith("check_desktop_update", {
      targetVersion: "0.1.6",
    });
    expect(mocks.provision).not.toHaveBeenCalled();
  });
  it("clears an obsolete pending target when both components have already advanced", async () => {
    appVersion = serverVersion = "0.1.6";
    localStorage.setItem(
      "hive-pending-update",
      JSON.stringify({
        targetVersion: "0.1.5",
        serverIdentity: "http://server.test:9420",
      }),
    );
    await refreshServerCompatibility();
    expect(localStorage.getItem("hive-pending-update")).toBeNull();
  });
  it("never installs the Mac when a successful provision reports a newer unexpected backend", async () => {
    mocks.provision.mockImplementation(async () => {
      serverVersion = "0.1.6";
    });
    const { result } = store();
    await offer();
    await launch();
    expect(mocks.install).not.toHaveBeenCalled();
    expect(result.current.update).toMatchObject({
      phase: "failed",
      error: expect.stringContaining("advanced"),
    });
  });
  it("stops after a bounded readiness wait when the old backend remains healthy", async () => {
    vi.useFakeTimers();
    try {
      mocks.provision.mockResolvedValue(undefined);
      const { result } = store();
      await offer();
      await launch();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(65_000);
      });
      expect(mocks.install).not.toHaveBeenCalled();
      expect(result.current.update).toMatchObject({
        phase: "failed",
        error: expect.stringContaining("did not report version"),
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("connection approval", () => {
  it.each(["endpoint", "credentials"])(
    "revokes approval before %s changes and does not refetch ordinary observers",
    async (change) => {
      await refreshServerCompatibility();
      expect(serverCompatibilityMatchesConnection(getConnection())).toBe(true);
      const ordinaryQuery = vi.fn(async () => ({
        host: getConnection()?.host,
        token: getConnection()?.authToken,
      }));
      const observer = new QueryObserver(queryClient, {
        queryKey: ["projects"],
        queryFn: ordinaryQuery,
      });
      const unsubscribe = observer.subscribe(() => {});
      await waitFor(() =>
        expect(observer.getCurrentResult().isSuccess).toBe(true),
      );
      expect(ordinaryQuery).toHaveBeenCalledOnce();
      const next =
        change === "endpoint"
          ? { ...connection, host: "new-server.test" }
          : { ...connection, authToken: "new-token" };
      await act(() => switchServer(next));
      expect(serverCompatibilityMatchesConnection(getConnection())).toBe(false);
      expect(ordinaryQuery).toHaveBeenCalledOnce();
      expect(queryClient.getQueryData(["projects"])).toBeUndefined();
      unsubscribe();
      observer.destroy();
      await act(() => refreshServerCompatibility());
      expect(serverCompatibilityMatchesConnection(getConnection())).toBe(true);
      const remounted = new QueryObserver(queryClient, {
        queryKey: ["projects"],
        queryFn: ordinaryQuery,
      });
      const stop = remounted.subscribe(() => {});
      await waitFor(() =>
        expect(remounted.getCurrentResult().data).toEqual({
          host: next.host,
          token: next.authToken,
        }),
      );
      expect(ordinaryQuery).toHaveBeenCalledTimes(2);
      stop();
      remounted.destroy();
      queryClient.clear();
    },
  );
  it("refreshes a mounted connection health observer while ordinary queries stay removed", async () => {
    await refreshServerCompatibility();
    const health = vi.fn(async () => getConnection()?.host);
    const observer = new QueryObserver(queryClient, {
      queryKey: ["health"],
      queryFn: health,
    });
    const unsubscribe = observer.subscribe(() => {});
    await waitFor(() =>
      expect(observer.getCurrentResult().data).toBe(connection.host),
    );
    await act(() => switchServer({ ...connection, host: "new-server.test" }));
    await waitFor(() =>
      expect(observer.getCurrentResult().data).toBe("new-server.test"),
    );
    expect(health).toHaveBeenCalledTimes(2);
    unsubscribe();
    observer.destroy();
    queryClient.clear();
  });
  it("revokes approval synchronously for direct auth changes, but keeps it for an SSH key selection", async () => {
    await refreshServerCompatibility();
    replaceConnection({ ...connection, sshKeyPath: "/keys/other" });
    expect(serverCompatibilityMatchesConnection(getConnection())).toBe(true);
    replaceConnection({ ...connection, authToken: "replacement" });
    expect(serverCompatibilityMatchesConnection(getConnection())).toBe(false);
  });
});

describe("compatibility watcher", () => {
  it("opens Updates from the toast without starting an update", async () => {
    renderHook(() => useDesktopUpdate());
    await settle();
    const openUpdates = vi.fn();
    const unsubscribe = subscribeAppCommand("open-updates", openUpdates);
    try {
      const renderToast = mocks.custom.mock.calls.at(-1)![0];
      const toast = renderToast("toast");
      expect(toast.props.actionLabel).toBe("View update");
      act(() => toast.props.onAction());
      await settle();
      expect(openUpdates).toHaveBeenCalledOnce();
      expect(mocks.download).not.toHaveBeenCalled();
      expect(mocks.provision).not.toHaveBeenCalled();
      expect(mocks.install).not.toHaveBeenCalled();
      expect(localStorage.getItem("hive-pending-update")).toBeNull();
    } finally {
      unsubscribe();
    }
  });
  it("rejects a previously offered toast action while an installer overlay is open", async () => {
    const { rerender } = renderHook(
      ({ enabled }) => useDesktopUpdate(enabled),
      { initialProps: { enabled: true } },
    );
    await settle();
    expect(mocks.custom).toHaveBeenCalled();
    const renderToast = mocks.custom.mock.calls.at(-1)![0];
    const staleAction = renderToast("toast").props.onAction;
    rerender({ enabled: false });
    fetchMock.mockClear();
    mocks.check.mockClear();
    act(() => staleAction());
    await settle();
    await offer();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.check).not.toHaveBeenCalled();
    expect(order).toEqual([]);
  });

  it.each(["dev", "web", "unconfigured", "setupPending", "installer"])(
    "does nothing in %s",
    async (mode) => {
      if (mode === "dev") vi.stubEnv("PROD", false);
      if (mode === "web")
        delete (window as unknown as Record<string, unknown>)
          .__TAURI_INTERNALS__;
      if (mode === "unconfigured") replaceConnection(null);
      if (mode === "setupPending")
        replaceConnection({ ...connection, setupPending: true });
      renderHook(() => useDesktopUpdate(mode !== "installer"));
      await settle();
      await offer();
      await launch();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mocks.check).not.toHaveBeenCalled();
    },
  );
  it("reports inaccessible servers and recovers on focus", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Offline"));
    const { result } = renderHook(() => {
      useDesktopUpdate();
      return useServerCompatibility();
    });
    await waitFor(() => expect(result.current.phase).toBe("unavailable"));
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
  });
  it("rejects unknown versions and compares numeric version segments", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBe(1);
    expect(() => compareVersions("garbage", "0.1.4")).toThrow("Unsupported");
  });
});


describe("release version precedence", () => {
  it("orders prereleases numerically and lexically before their stable release", () => {
    const versions = ["0.1.4", "0.1.5-alpha", "0.1.5-alpha.1", "0.1.5-alpha.beta", "0.1.5-beta", "0.1.5-beta.2", "0.1.5-beta.11", "0.1.5-rc.1", "0.1.5"];
    for (let i = 1; i < versions.length; i++) {
      expect(compareVersions(versions[i - 1]!, versions[i]!)).toBe(-1);
      expect(compareVersions(versions[i]!, versions[i - 1]!)).toBe(1);
    }
    expect(compareVersions("0.1.5-beta.1", "0.1.5-beta.1")).toBe(0);
  });
  it.each(["0.1.5-beta.01", "0.1.5-beta..1", "0.1.5-", "0.1.5-beta/1", "v0.1.5-beta.1", "0.01.5-beta.1", "0.1.5-beta.1\n"])("rejects invalid release %j", (value) => {
    expect(() => compareVersions(value, "0.1.4")).toThrow("Unsupported");
  });
});
