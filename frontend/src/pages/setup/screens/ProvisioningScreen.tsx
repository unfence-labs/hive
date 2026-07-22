import { useEffect, useRef, useState } from "react";
import { CheckIcon, CircleIcon, XCircleIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SetupScreen } from "./SetupScreen";
import { ErrorPanel } from "./ErrorPanel";
import {
  applyProvisionEvent,
  initialProgress,
  type ProvisionProgress,
  type ProvisionStepStatus,
  type ProvisionStepView,
} from "@/pages/setup/provision-progress";
import type { ProvisionEvent, ProvisionClient, ProvisionParams } from "@/lib/provision-client";
import type { SetupError } from "@/pages/setup/machine";

interface ProvisioningScreenProps {
  client: ProvisionClient;
  params: ProvisionParams;
  /** tailnetIp is set when the server joined a tailnet — the wizard should target it. */
  onDone: (tailnetIp?: string) => void;
  onBack: () => void;
  onContinueLater: () => void;
  /** Abandon this install and restart the wizard from the beginning. */
  onStartOver: () => void;
  /** Override the install copy (e.g. for a server update run). */
  title?: string;
  description?: string;
}

/** Reuses TaskTracker's status-icon language for the provision checklist. */
function StepIcon({ status }: { status: ProvisionStepStatus }) {
  switch (status) {
    case "succeeded":
    case "skipped":
      return <CheckIcon className="size-3.5 text-success-foreground" />;
    case "running":
      return <span className="inline-block size-2 animate-pulse rounded-full bg-primary" />;
    case "failed":
      return <XCircleIcon className="size-3.5 text-destructive" />;
    default:
      return <CircleIcon className="size-3.5 text-muted-foreground/40" />;
  }
}

function StepRow({ step }: { step: ProvisionStepView }) {
  return (
    <div className="flex items-center gap-2 py-1 text-xs">
      <span className="flex size-4 shrink-0 items-center justify-center">
        <StepIcon status={step.status} />
      </span>
      <span
        className={cn(
          "min-w-0 flex-1",
          step.status === "succeeded" && "text-muted-foreground/60",
          step.status === "skipped" && "text-muted-foreground/50 line-through",
          step.status === "running" && "text-foreground",
          step.status === "failed" && "text-destructive",
          step.status === "pending" && "text-muted-foreground/50",
        )}
      >
        {step.title}
      </span>
    </div>
  );
}

interface ProvisionRunEntry {
  events: ProvisionEvent[];
  listeners: Set<(event: ProvisionEvent) => void>;
  finished: boolean;
}

const provisionRuns = new Map<string, ProvisionRunEntry>();

export async function abandonProvisionRuns(client: ProvisionClient): Promise<void> {
  const hasActive = [...provisionRuns.values()].some((run) => !run.finished);
  provisionRuns.clear();
  if (!hasActive) return;
  try {
    await client.cancelProvision();
  } catch {
    // Best-effort: the sidecar may have no active process to cancel.
  }
}

function provisionRunKey(params: ProvisionParams): string {
  return JSON.stringify({
    host: params.host,
    user: params.user || "root",
    keyPath: params.keyPath,
    port: params.port ?? 3000,
    skipTailscale: params.skipTailscale,
  });
}

function createProvisionRun(
  key: string,
  client: ProvisionClient,
  params: ProvisionParams,
): ProvisionRunEntry {
  const entry: ProvisionRunEntry = { events: [], listeners: new Set(), finished: false };
  provisionRuns.set(key, entry);

  void (async () => {
    try {
      for await (const event of client.startProvision(params)) {
        entry.events.push(event);
        for (const listener of entry.listeners) listener(event);
      }
    } catch (error) {
      const event: ProvisionEvent = {
        kind: "step_error",
        seq: -1,
        step: "provision",
        errorCode: "UNKNOWN",
        detail: error instanceof Error ? error.message : String(error),
      };
      entry.events.push(event);
      for (const listener of entry.listeners) listener(event);
    } finally {
      entry.finished = true;
      if (provisionRuns.get(key) === entry) provisionRuns.delete(key);
    }
  })();
  return entry;
}

function getProvisionRun(
  client: ProvisionClient,
  params: ProvisionParams,
): ProvisionRunEntry {
  const key = provisionRunKey(params);
  const existing = provisionRuns.get(key);
  if (existing) return existing;
  return createProvisionRun(key, client, params);
}

/**
 * Drive one provision run per host and fold its buffered events into a
 * renderable progress. Buffering prevents React StrictMode remounts from
 * launching a second SSH process.
 */
export function useProvisionRun(
  client: ProvisionClient,
  params: ProvisionParams,
  onDone: (tailnetIp?: string) => void,
) {
  const [progress, setProgress] = useState<ProvisionProgress>(initialProgress);
  const [attempt, setAttempt] = useState(0);
  const doneRef = useRef(false);
  const paramsRef = useRef(params);
  const runRef = useRef<{ client: ProvisionClient; key: string; run: ProvisionRunEntry } | null>(null);
  paramsRef.current = params;
  const key = provisionRunKey(params);

  useEffect(() => {
    if (!runRef.current || runRef.current.client !== client || runRef.current.key !== key) {
      runRef.current = { client, key, run: getProvisionRun(client, paramsRef.current) };
    }
    const run = runRef.current.run;
    const apply = (event: ProvisionEvent) => {
      setProgress((current) => applyProvisionEvent(current, event));
    };
    run.listeners.add(apply);
    for (const event of run.events) apply(event);
    return () => {
      run.listeners.delete(apply);
    };
  }, [attempt, client, key]);

  useEffect(() => {
    if (progress.status === "succeeded" && !doneRef.current) {
      doneRef.current = true;
      onDone(progress.tailnetIp);
    }
    // onDone intentionally unbound: parents pass inline closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress.status, progress.tailnetIp]);

  const retry = () => {
    doneRef.current = false;
    setProgress(initialProgress());
    runRef.current = { client, key, run: createProvisionRun(key, client, paramsRef.current) };
    setAttempt((current) => current + 1);
  };

  const error: SetupError | null = progress.error
    ? {
        state: "provisioning",
        code: progress.error.code,
        logExcerpt: progress.error.detail,
      }
    : null;

  return { progress, retry, error };
}

/** The provision checklist, renderable in any container. */
export function ProvisionStepList({ progress }: { progress: ProvisionProgress }) {
  return progress.steps.length === 0 ? (
    <p className="text-xs text-muted-foreground">Starting…</p>
  ) : (
    <>
      {progress.steps.map((step) => (
        <StepRow key={step.id} step={step} />
      ))}
    </>
  );
}

export function ProvisioningScreen({
  client,
  params,
  onDone,
  onBack,
  onContinueLater,
  onStartOver,
  title = "Installing Hive on your server",
  description = "This runs over SSH and takes a few minutes. If it is interrupted, Retry resumes the idempotent install.",
}: ProvisioningScreenProps) {
  const { progress, retry, error } = useProvisionRun(client, params, onDone);

  return (
    <SetupScreen
      title={title}
      description={description}
      onBack={progress.status === "failed" ? onBack : undefined}
      onContinueLater={onContinueLater}
      footer={
        <Button
          variant="ghost"
          size="sm"
          onClick={onStartOver}
          className="text-muted-foreground"
        >
          Start over
        </Button>
      }
    >
      <div className="rounded-lg border border-border/50 bg-card/50 p-4">
        <ProvisionStepList progress={progress} />
      </div>

      {error && (
        <div className="mt-4">
          <ErrorPanel error={error} onRetry={retry} />
        </div>
      )}
    </SetupScreen>
  );
}
