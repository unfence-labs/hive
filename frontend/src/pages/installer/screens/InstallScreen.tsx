import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Circle, Minus, X } from "lucide-react";
import { InstallerScreen } from "./InstallerScreen";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  provisionErrorHint,
  type InstallRequest,
  type ProvisionClient,
} from "@/lib/provision-client";
import { parseAddress, type InstallerInputs } from "@/pages/installer/machine";
import type { InstallStep, InstallStepStatus } from "@/pages/installer/install-progress";
import { useInstallRun } from "@/pages/installer/install-run";

export interface InstallResult {
  accessToken: string;
  /** Service account for day-to-day sessions — never the account that installed. */
  serviceUser: string;
}

interface InstallScreenProps {
  client: ProvisionClient;
  inputs: InstallerInputs;
  /** Escalation password, when preflight said the account needs one. */
  password?: string;
  onComplete: (result: InstallResult) => void;
  /** Correct the plan after a failure. Never offered while a run is going. */
  onBack: () => void;
}

const STATUS_ICON: Record<InstallStepStatus, React.ReactNode> = {
  pending: <Circle className="h-3.5 w-3.5 text-muted-foreground/30" />,
  running: <Spinner className="h-3.5 w-3.5" />,
  done: <Check className="h-3.5 w-3.5 text-success" />,
  skipped: <Minus className="h-3.5 w-3.5 text-muted-foreground/50" />,
  failed: <X className="h-3.5 w-3.5 text-destructive" />,
};

function StepRow({ step }: { step: InstallStep }) {
  return (
    <li className="flex items-center gap-2 py-1 text-sm">
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        {STATUS_ICON[step.status]}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          step.status === "pending" && "text-muted-foreground/50",
          step.status === "running" && "text-foreground",
          step.status === "done" && "text-muted-foreground",
          step.status === "skipped" && "text-muted-foreground/50",
          step.status === "failed" && "text-destructive",
        )}
      >
        {step.title}
      </span>
      {step.status === "skipped" && (
        <span className="shrink-0 text-[11px] text-muted-foreground/50">already done</span>
      )}
    </li>
  );
}

function buildRequest(inputs: InstallerInputs, password?: string): InstallRequest {
  const { host, user } = parseAddress(inputs.address);
  return {
    connection: { host, ...(user ? { user } : {}), keyPath: inputs.sshKeyPath ?? "" },
    options: {
      port: inputs.port,
      installDir: inputs.installDir,
      dataDir: inputs.dataDir,
      ...(inputs.firewallInterface ? { firewallInterface: inputs.firewallInterface } : {}),
      ...(inputs.sshPublicKey ? { sshPublicKey: inputs.sshPublicKey } : {}),
    },
    ...(password === undefined ? {} : { password }),
  };
}

/**
 * The install, running.
 *
 * There is deliberately no back, no cancel, no skip and no start-over while a
 * run is going. Not to trap anyone — a laptop sleeping or a network dropping
 * abandons the run anyway — but because none of those controls could keep their
 * promise: the script runs on the server, and killing the local ssh process
 * would stop only this end of it. What makes that safe is that the run resumes:
 * the script records each completed step on the server, so relaunching the app
 * or pressing Retry continues from there instead of starting again.
 *
 * A failed run is not a run in progress, so failure offers both Retry and Back.
 */
export function InstallScreen({
  client,
  inputs,
  password,
  onComplete,
  onBack,
}: InstallScreenProps) {
  const [request] = useState(() => buildRequest(inputs, password));
  const { progress, retry } = useInstallRun(client, request);
  const [showLog, setShowLog] = useState(true);
  const logRef = useRef<HTMLPreElement | null>(null);
  const completedRef = useRef(false);

  useEffect(() => {
    if (progress.status !== "succeeded" || completedRef.current) return;
    completedRef.current = true;
    // A run only reaches "succeeded" with both of these reported; a run that
    // reported neither is a failure, not something to fill in from a default.
    onComplete({
      accessToken: progress.accessToken as string,
      serviceUser: progress.serviceUser as string,
    });
    // onComplete is an inline closure on the parent; the run's outcome is what
    // decides when it fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress.status, progress.accessToken, progress.serviceUser]);

  useLayoutEffect(() => {
    const element = logRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [progress.logs, showLog]);

  const failed = progress.status === "failed";

  return (
    <InstallerScreen
      title="Installing Hive"
      description={
        failed
          ? "The install stopped. Retry continues from the last completed step; Back returns to the plan so you can correct it."
          : "This runs on the server and takes a few minutes. It cannot be cancelled — closing the app pauses it, and reopening the installer picks it up where it stopped."
      }
      onBack={failed ? onBack : undefined}
      footer={
        failed ? (
          <Button variant="outline" size="sm" onClick={retry}>
            Retry
          </Button>
        ) : undefined
      }
    >
      {progress.resumed && !failed && (
        <p className="mb-3 text-xs text-muted-foreground">
          Continuing an earlier run on this server. Steps that are already done are skipped.
        </p>
      )}

      <ul aria-label="Install steps" className="rounded-lg border border-border/50 bg-card/50 p-3">
        {progress.steps.length === 0 ? (
          <li className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
            <Spinner className="h-3.5 w-3.5" />
            Starting the install…
          </li>
        ) : (
          progress.steps.map((step) => <StepRow key={step.id} step={step} />)
        )}
      </ul>

      {failed && progress.failure && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"
        >
          <p className="font-medium text-destructive">{progress.failure.code}</p>
          <p className="mt-1 text-muted-foreground">
            {provisionErrorHint(progress.failure.code)}
          </p>
          <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-2 font-mono text-[11px] text-muted-foreground">
            {progress.failure.detail}
          </pre>
        </div>
      )}

      <div className="mt-4">
        <button
          type="button"
          aria-expanded={showLog}
          onClick={() => setShowLog((value) => !value)}
          className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {showLog ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          Output
        </button>
        {showLog && (
          <pre
            ref={logRef}
            aria-label="Install output"
            className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground"
          >
            {progress.logs.length === 0
              ? "Waiting for output…"
              : progress.logs.map((entry) => `${entry.line}\n`).join("")}
          </pre>
        )}
      </div>
    </InstallerScreen>
  );
}
