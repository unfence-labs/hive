import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setupApi, pollOperation } from "@/hooks/useSetupApi";
import { createProvisionClient } from "@/lib/provision-client";
import {
  DetectionRow,
  DETECTED_LABELS,
  OperationActions,
  ClaudeSignIn,
} from "@/pages/setup/screens/GuidedSetupScreen";
import type {
  SetupStatus,
  SetupOperation,
  DetectableTool,
  ToolDetection,
} from "@hive/shared/setup-types";

/**
 * Post-install surface for the connected server (§ setup engine): shows what
 * is installed there and drives the same install / sign-in operations as the
 * wizard's guided setup, via the stored connection (server URL + token).
 */
export default function ServerToolsSettings() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeOp, setActiveOp] = useState<SetupOperation | null>(null);
  const [claudeDone, setClaudeDone] = useState(false);
  const client = useMemo(() => createProvisionClient(), []);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setStatus(await setupApi.getStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runSteps = async (steps: string[]) => {
    if (steps.length === 0) return;
    setBusy(true);
    setError(null);
    setActiveOp(null);
    try {
      const { operationId } = await setupApi.run({ steps });
      const op = await pollOperation(operationId, setActiveOp);
      if (op.status === "failed") {
        const failed = op.steps.find((s) => s.status === "failed");
        setError(failed?.error?.code ?? "operation failed");
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setActiveOp(null);
    }
  };

  const submitClaudeToken = async (token: string) => {
    await setupApi.submitClaudeToken(token);
    setClaudeDone(true);
    await refresh();
  };

  const detected = status?.detected;
  const claude = detected?.claude;
  const claudeAuthed = claude?.authenticated === true || claudeDone;

  return (
    <section className="rounded-lg border border-border/50 bg-card/50 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">Server tools</h2>
        <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={busy}>
          <RefreshCw className="h-3 w-3" /> Refresh
        </Button>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        What is installed on the connected server, and the same install / sign-in actions as the
        setup wizard.
      </p>

      {error && (
        <p className="mb-3 rounded border border-destructive/30 bg-destructive/5 p-2 font-mono text-[11px] text-destructive">
          {error}
        </p>
      )}

      {status === null && !error ? (
        <p className="text-xs text-muted-foreground">Detecting tools…</p>
      ) : detected ? (
        <div className="space-y-4">
          <div>
            {(Object.entries(detected) as [DetectableTool, ToolDetection][]).map(([tool, detection]) => (
              <DetectionRow key={tool} tool={tool} detection={detection} />
            ))}
          </div>

          <div className="rounded border border-border/50 p-3">
            <h3 className="mb-1 text-xs font-medium text-foreground">Claude</h3>
            {claudeAuthed ? (
              <div className="flex items-center gap-2 text-xs text-success-foreground">
                <CheckCircle2 className="h-3.5 w-3.5" /> Claude connected
              </div>
            ) : (
              <div className="space-y-2">
                {!claude?.installed && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void runSteps(["install_claude"])}>
                    Install
                  </Button>
                )}
                <ClaudeSignIn client={client} submitToken={submitClaudeToken} onError={setError} />
              </div>
            )}
          </div>

          {(["gh", "codex"] as const).map((tool) => {
            const det = detected[tool];
            return (
              <div key={tool} className="rounded border border-border/50 p-3">
                <h3 className="mb-1 text-xs font-medium text-foreground">{DETECTED_LABELS[tool] ?? tool}</h3>
                <div className="flex gap-2">
                  {!det?.installed && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void runSteps([`install_${tool}`])}>
                      Install
                    </Button>
                  )}
                  {det?.installed && det.authenticated !== true && (
                    <Button size="sm" disabled={busy} onClick={() => void runSteps([`auth_${tool}`])}>
                      Authenticate
                    </Button>
                  )}
                  {det?.installed && det.authenticated === true && (
                    <div className="flex items-center gap-2 text-xs text-success-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Connected
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {activeOp && <OperationActions op={activeOp} />}
        </div>
      ) : null}
    </section>
  );
}
