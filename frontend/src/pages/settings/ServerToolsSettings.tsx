import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setupApi, pollOperation } from "@/hooks/useSetupApi";
import { createProvisionClient } from "@/lib/provision-client";
import { isTauri } from "@/lib/is-tauri";
import {
  DetectionRow,
  DETECTED_LABELS,
  OperationActions,
} from "@/pages/setup/screens/GuidedSetupScreen";
import type {
  SetupStatus,
  SetupOperation,
  DetectableTool,
  ToolDetection,
} from "@hive/shared/setup-types";

type StackTool = "mise" | "uv" | "docker";
type Language = "python" | "rust" | "java" | "go";

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
  const [stack, setStack] = useState<Record<StackTool, boolean>>({ mise: false, uv: false, docker: false });
  const [language, setLanguage] = useState<Language>("python");
  const [manualToken, setManualToken] = useState("");
  const [claudeDone, setClaudeDone] = useState(false);

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

  const runSteps = async (steps: string[], options?: Record<string, unknown>) => {
    if (steps.length === 0) return;
    setBusy(true);
    setError(null);
    setActiveOp(null);
    try {
      const { operationId } = await setupApi.run({ steps, options });
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

  const runClaudeAuth = async () => {
    setBusy(true);
    setError(null);
    try {
      const { token } = await createProvisionClient().runLocalClaudeAuth();
      await setupApi.submitClaudeToken(token);
      setClaudeDone(true);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitManualToken = async () => {
    setBusy(true);
    setError(null);
    try {
      await setupApi.submitClaudeToken(manualToken.trim());
      setManualToken("");
      setClaudeDone(true);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
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
                <div className="flex gap-2">
                  {!claude?.installed && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void runSteps(["install_claude"])}>
                      Install
                    </Button>
                  )}
                  {isTauri() && (
                    <Button size="sm" disabled={busy} onClick={() => void runClaudeAuth()}>
                      Sign in on this computer
                    </Button>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Or run <code>claude setup-token</code> in a terminal and paste the token:
                </p>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={manualToken}
                    onChange={(e) => setManualToken(e.target.value)}
                    placeholder="sk-ant-oat01-…"
                    className="min-w-0 flex-1 rounded border border-border/50 bg-background px-2 py-1 font-mono text-xs"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !manualToken.trim().startsWith("sk-ant-oat01-")}
                    onClick={() => void submitManualToken()}
                  >
                    Submit
                  </Button>
                </div>
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

          <div className="rounded border border-border/50 p-3">
            <h3 className="mb-1 text-xs font-medium text-foreground">Developer stack</h3>
            <div className="space-y-1.5">
              {(["mise", "uv", "docker"] as StackTool[]).map((tool) => (
                <label key={tool} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={stack[tool]}
                    disabled={detected[tool]?.installed}
                    onChange={(e) => setStack((s) => ({ ...s, [tool]: e.target.checked }))}
                  />
                  <span className="text-foreground">{DETECTED_LABELS[tool]}</span>
                  {detected[tool]?.installed && (
                    <span className="text-[11px] text-muted-foreground">installed</span>
                  )}
                </label>
              ))}
              {stack.mise && (
                <label className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
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
              className="mt-2"
              disabled={busy || (!stack.mise && !stack.uv && !stack.docker)}
              onClick={() =>
                void runSteps(
                  (["mise", "uv", "docker"] as StackTool[]).filter((t) => stack[t]).map((t) => `install_${t}`),
                  { language },
                )
              }
            >
              {busy ? "Working…" : "Install selected"}
            </Button>
          </div>

          {activeOp && <OperationActions op={activeOp} />}
        </div>
      ) : null}
    </section>
  );
}
