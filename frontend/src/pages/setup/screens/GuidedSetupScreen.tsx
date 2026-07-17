import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ExternalLink } from "lucide-react";
import { SetupScreen } from "./SetupScreen";
import { ErrorPanel } from "./ErrorPanel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { setupApi, pollOperation } from "@/hooks/useSetupApi";
import type { ProvisionClient } from "@/lib/provision-client";
import type {
  SetupStatus,
  SetupOperation,
  DetectableTool,
  ToolDetection,
} from "@hive/shared/setup-types";
import type { SetupError } from "@/pages/setup/machine";

interface GuidedSetupScreenProps {
  client: ProvisionClient;
  onContinue: () => void;
  onBack: () => void;
  onContinueLater: () => void;
}

type StackTool = "mise" | "uv" | "docker";
type Language = "python" | "rust" | "java" | "go";

const DETECTED_LABELS: Partial<Record<DetectableTool, string>> = {
  claude: "Claude",
  codex: "Codex",
  gh: "GitHub CLI",
  tailscale: "Tailscale",
  node: "Node.js",
  mise: "mise",
  uv: "uv",
  docker: "Docker",
};

function DetectionRow({ tool, detection }: { tool: DetectableTool; detection: ToolDetection }) {
  const label = DETECTED_LABELS[tool] ?? tool;
  return (
    <div className="flex items-center gap-2 py-1 text-xs">
      <span className="min-w-0 flex-1 text-foreground">{label}</span>
      {detection.version && <span className="text-muted-foreground/60">{detection.version}</span>}
      {detection.installed ? (
        detection.authenticated === false ? (
          <Badge variant="outline">needs sign-in</Badge>
        ) : (
          <Badge variant="secondary">installed</Badge>
        )
      ) : (
        <Badge variant="outline">missing</Badge>
      )}
    </div>
  );
}

/**
 * Interactive action carried on a step (§3.5). Not yet part of the shared
 * SetupStep type, so narrowed locally rather than redefining the contract.
 */
interface StepAction {
  kind: "open_url" | "open_url_with_code";
  url: string;
  code?: string;
  expiresAt?: string;
}

function stepAction(step: SetupOperation["steps"][number]): StepAction | undefined {
  return (step as { action?: StepAction }).action;
}

/** Renders an open_url / open_url_with_code action from an operation step (§3.5). */
function OperationActions({ op }: { op: SetupOperation }) {
  const actionable = op.steps
    .map((step) => ({ step, action: stepAction(step) }))
    .filter((e): e is { step: SetupOperation["steps"][number]; action: StepAction } => !!e.action);
  if (actionable.length === 0) return null;
  return (
    <div className="mt-3 space-y-2">
      {actionable.map(({ step, action }) => {
        return (
          <div key={step.id} className="rounded border border-border/50 bg-card/50 p-3 text-xs">
            <p className="font-medium text-foreground">{step.title}</p>
            <a
              href={action.url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-primary hover:underline"
            >
              {action.url} <ExternalLink className="h-3 w-3" />
            </a>
            {action.code && (
              <p className="mt-1">
                Code: <code className="rounded bg-muted px-1 font-mono">{action.code}</code>
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function GuidedSetupScreen({
  client,
  onContinue,
  onBack,
  onContinueLater,
}: GuidedSetupScreenProps) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [error, setError] = useState<SetupError | null>(null);
  const [stack, setStack] = useState<Record<StackTool, boolean>>({ mise: false, uv: false, docker: false });
  const [language, setLanguage] = useState<Language>("python");
  const [claudeBusy, setClaudeBusy] = useState(false);
  const [claudeDone, setClaudeDone] = useState(false);
  const [activeOp, setActiveOp] = useState<SetupOperation | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await setupApi.getStatus());
    } catch {
      setError({ state: "guided_setup", code: "UNKNOWN" });
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const claudeDetection = status?.detected.claude;
  const claudeAuthed = claudeDetection?.authenticated === true || claudeDone;

  const runClaudeAuth = async () => {
    setClaudeBusy(true);
    setError(null);
    try {
      const { token } = await client.runLocalClaudeAuth();
      await setupApi.submitClaudeToken(token);
      setClaudeDone(true);
      await refreshStatus();
    } catch {
      setError({ state: "guided_setup", code: "CLAUDE_PASTEBACK_BROKEN" });
    } finally {
      setClaudeBusy(false);
    }
  };

  const runStacks = async () => {
    const steps: string[] = [];
    if (stack.mise) steps.push("install_mise");
    if (stack.uv) steps.push("install_uv");
    if (stack.docker) steps.push("install_docker");
    if (steps.length === 0) return;
    setError(null);
    try {
      const { operationId } = await setupApi.run({ steps, options: { language } });
      const op = await pollOperation(operationId, setActiveOp);
      if (op.status === "failed") {
        const failed = op.steps.find((s) => s.status === "failed");
        setError({ state: "guided_setup", code: failed?.error?.code ?? "UNKNOWN" });
      }
      await refreshStatus();
    } catch {
      setError({ state: "guided_setup", code: "UNKNOWN" });
    }
  };

  return (
    <SetupScreen
      title="Finish setting up your tools"
      description="Hive detected what's already on the server. Sign in to Claude and pick any extra tools you want."
      onContinue={onContinue}
      continueLabel="Continue"
      onBack={onBack}
      onContinueLater={onContinueLater}
    >
      {status === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" /> Detecting tools…
        </div>
      ) : (
        <div className="space-y-6">
          <section className="rounded-lg border border-border/50 bg-card/50 p-4">
            <h2 className="mb-2 text-xs font-medium text-muted-foreground">Detected</h2>
            {(Object.entries(status.detected) as [DetectableTool, ToolDetection][]).map(
              ([tool, detection]) => (
                <DetectionRow key={tool} tool={tool} detection={detection} />
              ),
            )}
          </section>

          <section className="rounded-lg border border-border/50 bg-card/50 p-4">
            <h2 className="mb-1 text-sm font-medium text-foreground">Claude</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Sign in with your Claude subscription on this computer. Your browser opens; Hive
              captures the token and sends it to the server.
            </p>
            {claudeAuthed ? (
              <div className="flex items-center gap-2 text-sm text-success-foreground">
                <CheckCircle2 className="h-4 w-4" /> Claude connected
              </div>
            ) : (
              <Button size="sm" onClick={() => void runClaudeAuth()} disabled={claudeBusy}>
                {claudeBusy ? "Waiting for browser…" : "Sign in on this computer"}
              </Button>
            )}
          </section>

          <section className="rounded-lg border border-border/50 bg-card/50 p-4">
            <h2 className="mb-1 text-sm font-medium text-foreground">Developer stack</h2>
            <p className="mb-3 text-xs text-muted-foreground">Optional runtime managers and tools.</p>
            <div className="space-y-2">
              {(["mise", "uv", "docker"] as StackTool[]).map((tool) => (
                <label key={tool} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={stack[tool]}
                    onChange={(e) => setStack((s) => ({ ...s, [tool]: e.target.checked }))}
                  />
                  <span className="text-foreground">{DETECTED_LABELS[tool]}</span>
                </label>
              ))}
              {stack.mise && (
                <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  Language
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value as Language)}
                    className="rounded border border-border/50 bg-background px-2 py-1 text-xs"
                  >
                    <option value="python">Python</option>
                    <option value="rust">Rust</option>
                    <option value="java">Java</option>
                    <option value="go">Go</option>
                  </select>
                </label>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              disabled={!stack.mise && !stack.uv && !stack.docker}
              onClick={() => void runStacks()}
            >
              Install selected
            </Button>
          </section>

          {activeOp && <OperationActions op={activeOp} />}
          {error && <ErrorPanel error={error} onDismiss={() => setError(null)} />}
        </div>
      )}
    </SetupScreen>
  );
}
