import { useEffect, useReducer, useRef, useState } from "react";
import { CheckIcon, CircleIcon, XCircleIcon } from "lucide-react";
import { cn } from "@/lib/utils";
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
  onDone: () => void;
  onBack: () => void;
  onContinueLater: () => void;
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

type Source = { kind: "start"; params: ProvisionParams } | { kind: "resume"; host: string };

export function ProvisioningScreen({
  client,
  params,
  onDone,
  onBack,
  onContinueLater,
}: ProvisioningScreenProps) {
  const [progress, dispatch] = useReducer(
    (state: ProvisionProgress, event: ProvisionEvent) => applyProvisionEvent(state, event),
    undefined,
    initialProgress,
  );
  const [source, setSource] = useState<Source>({ kind: "start", params });
  const [runId, setRunId] = useState(0);
  const doneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const iterable =
      source.kind === "start"
        ? client.startProvision(source.params)
        : client.resumeProvision(source.host);

    (async () => {
      try {
        for await (const event of iterable) {
          if (cancelled) return;
          dispatch(event);
        }
      } catch {
        if (!cancelled) {
          dispatch({
            kind: "step_error",
            seq: -1,
            step: "provision",
            errorCode: "UNKNOWN",
            detail: "The provision stream failed.",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // Re-run when the user retries (runId) or switches source.
  }, [client, source, runId]);

  useEffect(() => {
    if (progress.status === "succeeded" && !doneRef.current) {
      doneRef.current = true;
      onDone();
    }
  }, [progress.status, onDone]);

  const retry = () => {
    doneRef.current = false;
    setSource({ kind: "resume", host: params.host });
    setRunId((n) => n + 1);
  };

  const error: SetupError | null = progress.error
    ? {
        state: "provisioning",
        code: progress.error.code,
        logExcerpt: progress.error.detail,
      }
    : null;

  return (
    <SetupScreen
      title="Installing Hive on your server"
      description="This runs over SSH and continues even if you close the app. It takes a few minutes."
      onBack={progress.status === "failed" ? onBack : undefined}
      onContinueLater={onContinueLater}
    >
      <div className="rounded-lg border border-border/50 bg-card/50 p-4">
        {progress.steps.length === 0 ? (
          <p className="text-xs text-muted-foreground">Starting…</p>
        ) : (
          progress.steps.map((step) => <StepRow key={step.id} step={step} />)
        )}
      </div>

      {error && (
        <div className="mt-4">
          <ErrorPanel error={error} onRetry={retry} />
        </div>
      )}
    </SetupScreen>
  );
}
