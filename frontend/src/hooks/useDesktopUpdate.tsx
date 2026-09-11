import { useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { isDesktopShell } from "@/lib/is-desktop";
import {
  getConnection,
  serverUrlFor,
  useConnection,
  replaceConnection,
  type ServerConnection,
} from "@/hooks/useConnection";
import {
  createTauriProvisionClient,
  toProvisionError,
  type SshKey,
} from "@/lib/provision-client";
import type { ServerVersionResponse } from "@/lib/server-update";
import { HiveToast } from "@/components/ui/toaster";
import { dispatchAppCommand } from "@/lib/app-commands";

type Update = import("@tauri-apps/plugin-updater").Update;
export type DesktopUpdateState =
  | { phase: "idle" | "checking" | "upToDate" | "completed" }
  | { phase: "checkFailed"; error: string }
  | {
      phase: "available" | "resume" | "preparing" | "verifying" | "installing";
      version: string;
    }
  | { phase: "downloading"; version: string; percent: number | null }
  | { phase: "updatingServer"; version: string; step: string }
  | {
      phase: "input";
      version: string;
      kind: "agents" | "key" | "password";
      busyWorkspaces?: number;
      keys?: SshKey[];
    }
  | { phase: "failed"; version: string; error: string };
export interface ServerCompatibility {
  error?: string;
  phase: "checking" | "ready" | "unavailable";
  appVersion: string | null;
  server: ServerVersionResponse | null;
  serverIdentity: string | null;
}
class UpdateCancelled extends Error {}
interface PendingUpdate {
  targetVersion: string;
  serverIdentity: string;
}
export interface UpdateInput {
  keyPath?: string;
  password?: string;
  confirmAgents?: boolean;
}
const PENDING_KEY = "hive-pending-update";
const DISMISSED_KEY = "hive-dismissed-update-version";
const TOAST_ID = "hive-app-update";
const listeners = new Set<() => void>();
let state: DesktopUpdateState = { phase: "idle" };
let compatibility: ServerCompatibility = {
  phase: "checking",
  appVersion: null,
  server: null,
  serverIdentity: null,
};
let running = false;
let watcherEnabled = false;
let verifiedConnection: ServerConnection | null = null;
let checking = false;
let generation = 0;
let versionRequest = 0;
let busyWorkspaces: number | null = null;
let input: {
  resolve: (value: UpdateInput) => void;
  reject: (error: Error) => void;
} | null = null;
function notify() {
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function setState(next: DesktopUpdateState) {
  state = next;
  notify();
}
export function useDesktopUpdateState() {
  return useSyncExternalStore(subscribe, () => state);
}
export function useServerCompatibility() {
  return useSyncExternalStore(subscribe, () => compatibility);
}
/** Approval belongs to this endpoint and these credentials, never just its version. */
export function serverCompatibilityMatchesConnection(
  connection: ServerConnection | null,
) {
  return (
    compatibility.phase === "ready" &&
    connection !== null &&
    verifiedConnection !== null &&
    connectionIdentity(connection) === connectionIdentity(verifiedConnection) &&
    connection.authToken === verifiedConnection.authToken &&
    !connection.setupPending
  );
}

/** Revoke approval before publishing a different connection to query observers. */
export function invalidateServerCompatibility() {
  generation++;
  verifiedConnection = null;
  compatibility = {
    phase: "checking",
    appVersion: null,
    server: null,
    serverIdentity: null,
  };
  if (!running) state = { phase: "idle" };
  toast.dismiss(TOAST_ID);
  notify();
}
export function desktopUpdateInProgress() {
  return running;
}
export function setUpdateBusyWorkspaces(count: number | null) {
  busyWorkspaces = count;
}
export function shouldCheckForUpdates() {
  return isDesktopShell() && import.meta.env.PROD;
}
export function connectionIdentity(connection: ServerConnection) {
  return serverUrlFor(connection);
}

/** Releases currently use stable semantic versions; reject unknown formats instead of guessing. */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) => {
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value))
      throw new Error(`Unsupported release version: ${value}`);
    return value.split(".").map(BigInt);
  };
  const left = parse(a),
    right = parse(b);
  for (let i = 0; i < 3; i++)
    if (left[i] !== right[i]) return left[i]! > right[i]! ? 1 : -1;
  return 0;
}
function errorMessage(error: unknown) {
  return toProvisionError(error).detail;
}
function readPending(connection: ServerConnection): PendingUpdate | null {
  try {
    const record = JSON.parse(
      localStorage.getItem(PENDING_KEY) ?? "null",
    ) as PendingUpdate | null;
    if (
      !record ||
      record.serverIdentity !== connectionIdentity(connection) ||
      typeof record.targetVersion !== "string"
    )
      return null;
    compareVersions(record.targetVersion, record.targetVersion);
    return record;
  } catch {
    return null;
  }
}
function isCurrentConnection(connection: ServerConnection) {
  const current = getConnection();
  return (
    current !== null &&
    connectionIdentity(current) === connectionIdentity(connection) &&
    current.authToken === connection.authToken &&
    !current.setupPending
  );
}
function assertConnection(connection: ServerConnection) {
  if (!isCurrentConnection(connection)) {
    throw new Error(
      "The server connection changed. Retry on the intended server.",
    );
  }
}
async function getFromServer<T>(
  connection: ServerConnection,
  path: string,
): Promise<T> {
  const response = await fetch(`${serverUrlFor(connection)}${path}`, {
    headers: connection.authToken
      ? { Authorization: `Bearer ${connection.authToken}` }
      : {},
    signal: AbortSignal.timeout(5_000),
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(
      `Server unavailable (HTTP ${response.status}). Check the connection settings.`,
    );
  return response.json() as Promise<T>;
}
export async function fetchServerVersion(
  connection: ServerConnection,
): Promise<ServerVersionResponse> {
  const result = await getFromServer<ServerVersionResponse>(
    connection,
    "/api/server/version",
  );
  if (
    typeof result.version !== "string" ||
    !["manual", "provisioner"].includes(result.updateMethod)
  )
    throw new Error("The server returned an invalid version response.");
  compareVersions(result.version, result.version);
  return result;
}
export async function refreshServerCompatibility(): Promise<void> {
  if (!watcherEnabled || !shouldCheckForUpdates() || running) return;
  const connection = getConnection();
  if (!connection || connection.setupPending) return;
  const request = ++versionRequest;
  const epoch = generation;
  try {
    const [{ invoke }, server] = await Promise.all([
      import("@tauri-apps/api/core"),
      fetchServerVersion(connection),
    ]);
    const appVersion = await invoke<string>("app_version");
    compareVersions(appVersion, appVersion);
    assertConnection(connection);
    if (
      request !== versionRequest ||
      epoch !== generation ||
      running ||
      !isCurrentConnection(connection)
    )
      return;
    verifiedConnection = connection;
    compatibility = {
      phase: "ready",
      appVersion,
      server,
      serverIdentity: connectionIdentity(connection),
    };
    const pending = readPending(connection);
    if (
      pending &&
      appVersion === server.version &&
      compareVersions(appVersion, pending.targetVersion) >= 0
    ) {
      localStorage.removeItem(PENDING_KEY);
      setState({ phase: "completed" });
    } else if (pending && state.phase !== "failed") {
      if (
        server.updateMethod === "manual" &&
        compareVersions(appVersion, pending.targetVersion) >= 0
      )
        setState({ phase: "idle" });
      else {
        const installed =
          compareVersions(appVersion, server.version) > 0
            ? appVersion
            : server.version;
        setState({
          phase: "resume",
          version:
            compareVersions(pending.targetVersion, installed) >= 0
              ? pending.targetVersion
              : installed,
        });
      }
    }
    if (!pending && appVersion !== server.version && state.phase !== "failed") {
      toast.dismiss(TOAST_ID);
      if (
        server.updateMethod === "provisioner" ||
        compareVersions(server.version, appVersion) > 0
      ) {
        setState({
          phase: "available",
          version:
            compareVersions(appVersion, server.version) > 0
              ? appVersion
              : server.version,
        });
      }
    }
    notify();
  } catch (error) {
    if (
      request !== versionRequest ||
      epoch !== generation ||
      running ||
      !isCurrentConnection(connection)
    )
      return;
    verifiedConnection = null;
    compatibility = {
      ...compatibility,
      phase: "unavailable",
      server: null,
      error: errorMessage(error),
      serverIdentity: connectionIdentity(connection),
    };
    notify();
  }
}
function offerToast(version: string) {
  if (localStorage.getItem(DISMISSED_KEY) === version) return;
  toast.custom(
    (id) => (
      <HiveToast
        variant="success"
        title="Hive"
        status="UPDATE"
        description={`Version ${version} is available`}
        actionLabel="View update"
        onAction={() => {
          if (!watcherEnabled) return;
          dispatchAppCommand("open-updates");
          toast.dismiss(id);
        }}
        onClose={() => {
          localStorage.setItem(DISMISSED_KEY, version);
          toast.dismiss(id);
        }}
      />
    ),
    { id: TOAST_ID, duration: Infinity },
  );
}
function requiresCatchUp() {
  const { server, appVersion } = compatibility;
  return (
    server !== null &&
    appVersion !== null &&
    server.version !== appVersion &&
    (server.updateMethod === "provisioner" ||
      compareVersions(server.version, appVersion) > 0)
  );
}
async function runCheck(manual: boolean) {
  const connection = getConnection();
  if (
    !watcherEnabled ||
    !shouldCheckForUpdates() ||
    !connection ||
    connection.setupPending ||
    running ||
    checking
  )
    return;
  const { server, appVersion } = compatibility;
  if (requiresCatchUp()) return;
  const pending = readPending(connection);
  if (
    pending &&
    !(
      server?.updateMethod === "manual" &&
      appVersion &&
      compareVersions(appVersion, pending.targetVersion) >= 0
    )
  )
    return;
  checking = true;
  const request = generation;
  if (manual) setState({ phase: "checking" });
  let update: Update | null = null;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    update = await check();
    assertConnection(connection);
    if (request !== generation || running) return;
    if (requiresCatchUp()) return;
    if (update) {
      compareVersions(update.version, update.version);
      setState({ phase: "available", version: update.version });
      if (!manual) offerToast(update.version);
    } else setState({ phase: manual ? "upToDate" : "idle" });
  } catch (error) {
    if (request === generation && !running && manual && !requiresCatchUp())
      setState({ phase: "checkFailed", error: errorMessage(error) });
  } finally {
    checking = false;
    if (update) await update.close().catch(() => {});
  }
}
export function checkForUpdatesNow() {
  void runCheck(true);
}
function requestInput(
  version: string,
  kind: "agents" | "key" | "password",
  details: { keys?: SshKey[]; busyWorkspaces?: number } = {},
): Promise<UpdateInput> {
  setState({ phase: "input", version, kind, ...details });
  return new Promise((resolve, reject) => {
    input = { resolve, reject };
  });
}
export function respondToUpdate(value: UpdateInput) {
  const pending = input;
  input = null;
  pending?.resolve(value);
}
export function dismissUpdateInput() {
  const pending = input;
  input = null;
  pending?.reject(new UpdateCancelled());
}
async function waitForVersion(connection: ServerConnection, version: string) {
  for (let attempt = 0; attempt < 30; attempt++) {
    assertConnection(connection);
    let server: ServerVersionResponse | null = null;
    try {
      server = await fetchServerVersion(connection);
    } catch {
      /* The backend is restarting. */
    }
    if (server?.version === version) return server;
    if (server && compareVersions(server.version, version) > 0)
      throw new Error(
        `The server advanced to ${server.version}. Retry to update this Mac to that release.`,
      );
    if (attempt < 29)
      await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(
    `The server did not report version ${version}. Check the server and retry.`,
  );
}
async function runUpdate() {
  if (!watcherEnabled || !shouldCheckForUpdates() || running) return;
  const connection = getConnection();
  if (!connection || connection.setupPending) return;
  const pendingAtStart = readPending(connection);
  const offered = "version" in state ? state.version : null;
  let version = offered ?? compatibility.appVersion ?? "";
  let update: Update | null = null;
  const liveBusyCount = busyWorkspaces;
  running = true;
  generation++;
  toast.dismiss(TOAST_ID);
  setState({ phase: "preparing", version });
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const appVersion = await invoke<string>("app_version");
    let server = await fetchServerVersion(connection);
    assertConnection(connection);
    const pending = readPending(connection);
    const installed =
      compareVersions(appVersion, server.version) >= 0
        ? appVersion
        : server.version;
    // Resolve mismatches before looking for newer releases. Manual installations
    // may advance the desktop independently when the server is behind it.
    const independentDesktop =
      server.updateMethod === "manual" &&
      compareVersions(appVersion, server.version) >= 0;
    const requested =
      appVersion === server.version || independentDesktop
        ? (offered ?? pending?.targetVersion ?? installed)
        : installed;
    const unfinishedTarget =
      pending &&
      (compareVersions(appVersion, pending.targetVersion) < 0 ||
        (server.updateMethod === "provisioner" &&
          compareVersions(server.version, pending.targetVersion) < 0))
        ? pending.targetVersion
        : null;
    const target = unfinishedTarget ?? requested;
    version = compareVersions(target, installed) > 0 ? target : installed;
    const desktopNeeded = compareVersions(version, appVersion) > 0;
    if (
      server.updateMethod === "manual" &&
      !desktopNeeded &&
      server.version !== version
    )
      throw new Error(`Update the server manually to ${version}, then retry.`);
    if (version === appVersion && version === server.version) {
      localStorage.removeItem(PENDING_KEY);
      setState({ phase: "completed" });
      return;
    }
    localStorage.setItem(
      PENDING_KEY,
      JSON.stringify({
        targetVersion: version,
        serverIdentity: connectionIdentity(connection),
      } satisfies PendingUpdate),
    );
    if (desktopNeeded) {
      const { Update } = await import("@tauri-apps/plugin-updater");
      update = new Update(
        await invoke<ConstructorParameters<typeof Update>[0]>(
          "check_desktop_update",
          { targetVersion: version },
        ),
      );
      if (update.version !== version)
        throw new Error(
          "The downloaded release does not match the update target.",
        );
      setState({ phase: "downloading", version, percent: null });
      let total = 0,
        downloaded = 0;
      await update.download((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") downloaded += event.data.chunkLength;
        setState({
          phase: "downloading",
          version,
          percent: total
            ? Math.min(100, Math.round((downloaded / total) * 100))
            : null,
        });
      });
    }
    assertConnection(connection);
    server = await fetchServerVersion(connection);
    if (compareVersions(server.version, version) > 0)
      throw new Error(
        `The server advanced to ${server.version}. Retry to catch up.`,
      );
    if (server.updateMethod === "provisioner" && server.version !== version) {
      if (liveBusyCount === null || liveBusyCount > 0) {
        const answer = await requestInput(version, "agents", {
          busyWorkspaces: liveBusyCount ?? undefined,
        });
        if (!answer.confirmAgents) throw new Error("Update paused.");
      }
      const client = createTauriProvisionClient();
      let keyPath = connection.sshKeyPath;
      if (!keyPath) {
        const keys = (await client.listKeys()).filter((key) => key.usable);
        keyPath = (await requestInput(version, "key", { keys })).keyPath;
        if (!keyPath || !keys.some((key) => key.path === keyPath))
          throw new Error("Select a usable SSH key.");
        assertConnection(connection);
        replaceConnection({ ...connection, sshKeyPath: keyPath });
      }
      const provision = async (password?: string) => {
        assertConnection(connection);
        const latest = await fetchServerVersion(connection);
        if (compareVersions(latest.version, version) > 0)
          throw new Error(
            `The server advanced to ${latest.version}. Retry to catch up.`,
          );
        if (latest.version === version) return;
        if (latest.updateMethod !== "provisioner")
          throw new Error("The server now requires a manual update.");
        setState({
          phase: "updatingServer",
          version,
          step: "Connecting to the server…",
        });
        await client.install(
          {
            connection: {
              host: connection.host,
              user: connection.adminUser,
              keyPath: keyPath!,
            },
            options: {
              update: true,
              targetVersion: version,
              expectedVersion: latest.version,
            },
            password,
          },
          (record) => {
            if (record.status === "start" && record.step)
              setState({
                phase: "updatingServer",
                version,
                step: record.title ?? record.step.replaceAll("_", " "),
              });
          },
        );
      };
      try {
        await provision();
      } catch (error) {
        if (toProvisionError(error).code !== "SSH_PASSWORD_REQUIRED")
          throw error;
        const answer = await requestInput(version, "password");
        await provision(answer.password);
      }
      setState({ phase: "verifying", version });
      server = await waitForVersion(connection, version);
    }
    assertConnection(connection);
    server = await fetchServerVersion(connection);
    if (
      compareVersions(server.version, version) > 0 ||
      (server.updateMethod === "provisioner" && server.version !== version)
    )
      throw new Error(
        `Server version ${server.version} does not match target ${version}. Retry after checking the server.`,
      );
    if (update) {
      setState({ phase: "installing", version });
      await update.install();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } else {
      localStorage.removeItem(PENDING_KEY);
      setState({ phase: "completed" });
    }
  } catch (error) {
    if (error instanceof UpdateCancelled) {
      // These prompts precede server changes; SSH_PASSWORD_REQUIRED also means
      // the provisioner could not start. Cancel restores the prior usable flow.
      if (pendingAtStart) setState({ phase: "resume", version });
      else {
        localStorage.removeItem(PENDING_KEY);
        setState({ phase: "available", version });
      }
    } else setState({ phase: "failed", version, error: errorMessage(error) });
  } finally {
    if (update) await update.close().catch(() => {});
    running = false;
    notify();
    // Preserve the error/retry state until the next explicit action.
    await refreshServerCompatibility();
  }
}
export function installCurrentUpdate() {
  void runUpdate();
}
export function useDesktopUpdate(enabled = true) {
  const { connection } = useConnection();
  useEffect(() => {
    const currentConnection = getConnection();
    watcherEnabled =
      enabled &&
      shouldCheckForUpdates() &&
      currentConnection !== null &&
      !currentConnection.setupPending;
    if (!watcherEnabled || !currentConnection) return;
    generation++;
    if (!running) {
      compatibility = {
        phase: "checking",
        server: null,
        appVersion: null,
        serverIdentity: connectionIdentity(currentConnection),
      };
      setState({ phase: "idle" });
    }
    const refresh = () => {
      void refreshServerCompatibility();
    };
    void refreshServerCompatibility().then(() => runCheck(false));
    const interval = window.setInterval(
      () => void runCheck(false),
      4 * 60 * 60 * 1000,
    );
    const retry = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      watcherEnabled = false;
      generation++;
      clearInterval(interval);
      clearInterval(retry);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      toast.dismiss(TOAST_ID);
    };
  }, [
    enabled,
    connection?.host,
    connection?.port,
    connection?.protocol,
    connection?.authToken,
    connection?.setupPending,
  ]);
}
export function resetDesktopUpdateForTests(enabled = false) {
  verifiedConnection = null;
  watcherEnabled = enabled;
  state = { phase: "idle" };
  compatibility = {
    phase: "checking",
    appVersion: null,
    server: null,
    serverIdentity: null,
  };
  running = false;
  checking = false;
  generation++;
  busyWorkspaces = null;
  input = null;
}
