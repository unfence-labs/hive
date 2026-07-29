import { useCallback, useEffect, useRef, useState } from "react";
import {
  toProvisionError,
  type InstallRequest,
  type ProvisionClient,
  type ProvisionRecord,
} from "@/lib/provision-client";
import {
  applyInstallRecord,
  initialProgress,
  type InstallProgress,
} from "@/pages/installer/install-progress";

/**
 * One install run per server, owned by the module rather than by the screen.
 *
 * A run is an ssh process on the operator's machine driving a script on the
 * server. Tying its lifetime to a React component would mean a remount — a
 * StrictMode double-mount, a re-render on resize, a route change — spawning a
 * second one against the same server. So the registry owns the run and the
 * folded progress, and the screen only subscribes: re-entering an install
 * attaches to what is already going rather than starting anything.
 *
 * Everything here is in memory. The streamed output in particular never
 * reaches browser storage.
 */

interface InstallRun {
  progress: InstallProgress;
  listeners: Set<(progress: InstallProgress) => void>;
}

/**
 * How long streamed records may pool before the fold and the listeners see
 * them. apt and npm can emit hundreds of lines a second, and folding and
 * re-rendering per line is a render storm; per window it is one commit.
 */
export const INSTALL_FLUSH_MS = 50;

const runs = new Map<string, InstallRun>();

/**
 * Identity of a run: the server it targets and the layout it installs. Two
 * different servers are two different runs; the escalation password is
 * deliberately not part of it.
 */
export function installRunKey(request: InstallRequest): string {
  const { connection, options } = request;
  return JSON.stringify([
    connection.host,
    connection.user ?? "root",
    connection.keyPath,
    options.port,
    options.installDir,
    options.dataDir,
  ]);
}

function startRun(key: string, client: ProvisionClient, request: InstallRequest): InstallRun {
  const run: InstallRun = { progress: initialProgress(), listeners: new Set() };
  runs.set(key, run);

  let pending: ProvisionRecord[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    run.progress = batch.reduce(applyInstallRecord, run.progress);
    for (const listener of run.listeners) listener(run.progress);
  };

  const push = (record: ProvisionRecord) => {
    pending.push(record);
    timer ??= setTimeout(flush, INSTALL_FLUSH_MS);
  };

  void client.install(request, push).catch((caught: unknown) => {
    // The sidecar sends its own terminal record for anything it can type, so
    // this only closes the stream when the command itself rejected without
    // one — a dead channel, an invoke that never reached the run.
    flush();
    if (run.progress.status === "succeeded" || run.progress.status === "failed") return;
    const error = toProvisionError(caught);
    push({ event: "run_end", status: "error", errorCode: error.code, detail: error.detail });
    flush();
  });

  return run;
}

/** Attach to the run for this request, starting it only if there is none. */
export function getOrStartInstallRun(
  key: string,
  client: ProvisionClient,
  request: InstallRequest,
): InstallRun {
  return runs.get(key) ?? startRun(key, client, request);
}

/** Drop every run. Called once the installer is done with the server. */
export function clearInstallRuns(): void {
  runs.clear();
}

/**
 * Subscribe to the install for this request, starting it on first use.
 *
 * `retry` replaces the run with a fresh one over the same connection. The
 * script is marker-based, so that continues the install rather than repeating
 * the steps it already completed.
 */
export function useInstallRun(client: ProvisionClient, request: InstallRequest) {
  const key = installRunKey(request);
  // The request changes identity on every render; the key is what decides
  // whether it is still the same run.
  const requestRef = useRef(request);
  requestRef.current = request;
  const [attempt, setAttempt] = useState(0);
  const [progress, setProgress] = useState<InstallProgress>(initialProgress);

  useEffect(() => {
    const run = getOrStartInstallRun(key, client, requestRef.current);
    setProgress(run.progress);
    const listener = (next: InstallProgress) => setProgress(next);
    run.listeners.add(listener);
    return () => {
      run.listeners.delete(listener);
    };
  }, [attempt, client, key]);

  const retry = useCallback(() => {
    startRun(key, client, requestRef.current);
    setAttempt((value) => value + 1);
  }, [client, key]);

  return { progress, retry };
}
