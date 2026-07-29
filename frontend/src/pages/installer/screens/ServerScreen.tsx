import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  KeyRound,
  Lock,
  RefreshCw,
  ShieldQuestion,
  XCircle,
} from "lucide-react";
import { InstallerScreen } from "./InstallerScreen";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { TransportSecurityWarning } from "@/components/setup/TransportSecurityWarning";
import { cn } from "@/lib/utils";
import { isValidPort } from "@/lib/server-connection";
import { openExternal } from "@/lib/open-external";
import {
  provisionErrorHint,
  toProvisionError,
  type HostIdentity,
  type PreflightCheck,
  type PreflightReport,
  type ProvisionClient,
  type ProvisionError,
  type SshKey,
} from "@/lib/provision-client";
import {
  isUsableAddress,
  isUsableDirectory,
  parseAddress,
  type InstallerInputs,
} from "@/pages/installer/machine";
import {
  canProceed,
  checkTitle,
  correctableField,
  needsEscalationPassword,
} from "@/pages/installer/preflight";

/** Explains the supported private-network reachability paths. */
export const NETWORKING_GUIDE_URL =
  "https://github.com/unfence-labs/hive/blob/main/docs/networking.md";

interface ServerScreenProps {
  client: ProvisionClient;
  inputs: InstallerInputs;
  /** Hands the install everything it needs, including the escalation password. */
  onContinue: (values: Partial<InstallerInputs>, password?: string) => void;
  onBack: () => void;
}

/**
 * The whole "reach my server" conversation on one screen: the address and key
 * on top, and the proof that they work underneath.
 *
 * The form is never replaced by its own verification. Connect runs the
 * pipeline — reach, verify identity, preflight — as steps below the fields,
 * and every failure lands next to the field that corrects it. Editing anything
 * discards the verification: what was checked is no longer what would install.
 *
 * The operator is deliberately not asked how their private network is
 * arranged. Hive only explains the encrypted-network requirement.
 */
export function ServerScreen({ client, inputs, onContinue, onBack }: ServerScreenProps) {
  const [address, setAddress] = useState(inputs.address);
  const [port, setPort] = useState(String(inputs.port));
  const [installDir, setInstallDir] = useState(inputs.installDir);
  const [dataDir, setDataDir] = useState(inputs.dataDir);
  const [advanced, setAdvanced] = useState(false);

  // ── the key ────────────────────────────────────────────────────────────────
  const [keys, setKeys] = useState<SshKey[] | null>(null);
  const [keysError, setKeysError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | undefined>(inputs.sshKeyPath);
  const [keyListOpen, setKeyListOpen] = useState(false);
  const [scan, setScan] = useState(0);

  // ── the verification ───────────────────────────────────────────────────────
  type Phase = "idle" | "reaching" | "approve" | "checking" | "report" | "failed";
  const [phase, setPhase] = useState<Phase>("idle");
  /** Which pipeline step the `failed` phase belongs to. */
  const [failedStep, setFailedStep] = useState<"reach" | "check">("reach");
  const [identity, setIdentity] = useState<HostIdentity | null>(null);
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [error, setError] = useState<ProvisionError | null>(null);
  const [password, setPassword] = useState("");

  /**
   * Editing anything discards what was verified: the report described a
   * combination of inputs that no longer exists.
   */
  const invalidate = useCallback(() => {
    setPhase("idle");
    setIdentity(null);
    setReport(null);
    setError(null);
    setPassword("");
  }, []);

  const edit = <Value,>(set: (value: Value) => void) => {
    return (value: Value) => {
      set(value);
      invalidate();
    };
  };

  useEffect(() => {
    let cancelled = false;
    setKeys(null);
    setKeysError(null);
    client
      .listKeys()
      .then((found) => {
        if (cancelled) return;
        setKeys(found);
        setSelectedKey((current) => {
          const usable = found.filter((key) => key.usable);
          if (current && usable.some((key) => key.path === current)) return current;
          return usable[0]?.path;
        });
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setKeys([]);
        setKeysError(toProvisionError(caught).detail || "SSH keys could not be listed.");
      });
    return () => {
      cancelled = true;
    };
  }, [client, scan]);

  const { host, user } = parseAddress(address);
  const key = keys?.find((candidate) => candidate.path === selectedKey);
  const portNumber = Number(port);
  const formValid =
    isUsableAddress(address) &&
    isValidPort(portNumber) &&
    isUsableDirectory(installDir) &&
    isUsableDirectory(dataDir) &&
    key !== undefined;

  const runPreflight = useCallback(async () => {
    setPhase("checking");
    try {
      const result = await client.preflight(
        { host, ...(user ? { user } : {}), keyPath: selectedKey ?? "" },
        {
          port: portNumber,
          installDir: installDir.trim(),
          dataDir: dataDir.trim(),
          ...(key?.publicKey ? { sshPublicKey: key.publicKey } : {}),
        },
      );
      setReport(result);
      setPhase("report");
    } catch (caught: unknown) {
      setError(toProvisionError(caught));
      setFailedStep("check");
      setPhase("failed");
    }
  }, [client, dataDir, host, installDir, key?.publicKey, portNumber, selectedKey, user]);

  const connect = async () => {
    setPhase("reaching");
    setError(null);
    setReport(null);
    try {
      const found = await client.testConnection(host);
      setIdentity(found);
      if (found.trusted) await runPreflight();
      else setPhase("approve");
    } catch (caught: unknown) {
      setError(toProvisionError(caught));
      setFailedStep("reach");
      setPhase("failed");
    }
  };

  const approve = async () => {
    if (!identity) return;
    setPhase("checking");
    try {
      await client.trustHost(host, identity.hostKey);
    } catch (caught: unknown) {
      setError(toProvisionError(caught));
      setFailedStep("check");
      setPhase("failed");
      return;
    }
    await runPreflight();
  };

  const passwordRequired = report !== null && needsEscalationPassword(report);
  const ready =
    phase === "report" &&
    report !== null &&
    canProceed(report) &&
    (!passwordRequired || password !== "");

  const primary =
    phase === "approve"
      ? { label: "Approve fingerprint", action: () => void approve(), disabled: false }
      : phase === "report"
        ? {
            label: "Continue",
            action: () =>
              onContinue(
                {
                  address: address.trim(),
                  port: portNumber,
                  installDir: installDir.trim(),
                  dataDir: dataDir.trim(),
                  sshKeyPath: key?.path,
                  sshPublicKey: key?.publicKey,
                  hostKey: identity?.hostKey,
                  fingerprint: identity?.fingerprint,
                  // Carried forward so a relaunch knows whether the install can
                  // resume on its own or has to ask for the password again.
                  privilegeMode: report?.privilege.mode,
                },
                passwordRequired ? password : undefined,
              ),
            disabled: !ready,
          }
        : {
            label: "Connect",
            action: () => void connect(),
            disabled: !formValid || phase === "reaching" || phase === "checking",
          };

  return (
    <InstallerScreen
      title="Connect to your server"
      description={
        <>
          Hive installs itself over SSH. Type the address exactly as you would after{" "}
          <code className="font-mono text-xs text-foreground">ssh</code> — a Tailscale name
          or another private-network address that reaches the box.
        </>
      }
      onContinue={primary.action}
      continueLabel={primary.label}
      continueDisabled={primary.disabled}
      onBack={onBack}
    >
      {/* The shadcn Input look, rebuilt around a literal `$ ssh` prefix: the
          field asks for exactly what the operator types after it. */}
      <div className="flex h-9 w-full items-center rounded-md border border-input bg-field px-3 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
        <span
          aria-hidden
          className="select-none whitespace-nowrap font-mono text-xs text-muted-foreground"
        >
          $ ssh
        </span>
        <input
          id="server-address"
          aria-label="Address"
          value={address}
          onChange={(event) => edit(setAddress)(event.target.value)}
          placeholder="root@203.0.113.10"
          autoComplete="off"
          spellCheck={false}
          className="w-full bg-transparent pl-2 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>
      <TransportSecurityWarning className="mt-2" />
      <p className="mt-2 text-[11px] text-muted-foreground/60">
        <button
          type="button"
          className="cursor-pointer underline underline-offset-2 hover:text-foreground"
          onClick={() => void openExternal(NETWORKING_GUIDE_URL)}
        >
          Networking guide ↗
        </button>
      </p>

      <div className="mt-4">
        <span className="mb-1.5 block text-xs font-medium text-muted-foreground">SSH key</span>
        {keysError ? (
          <p role="alert" className="text-sm text-destructive">
            {keysError}
          </p>
        ) : keys === null ? (
          <div className="flex h-9 items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" /> Looking for SSH keys…
          </div>
        ) : keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No private keys found under <code>~/.ssh</code>. Create one, authorize it on the
            server, then scan again.
          </p>
        ) : (
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <button
                type="button"
                aria-label="SSH key"
                aria-expanded={keyListOpen}
                onClick={() => setKeyListOpen((open) => !open)}
                className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-md border border-input bg-field px-3 text-left shadow-xs"
              >
                <KeyRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {key ? (
                  <>
                    <span className="text-xs font-medium text-foreground">{key.label}</span>
                    <span className="truncate font-mono text-[11px] text-muted-foreground/60">
                      {key.path}
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">Choose a key</span>
                )}
                <ChevronDown
                  className={cn(
                    "ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                    keyListOpen && "rotate-180",
                  )}
                />
              </button>

              {keyListOpen && (
                <div className="mt-2 space-y-2">
                  {keys.map((candidate) => (
                    <button
                      key={candidate.path}
                      type="button"
                      disabled={!candidate.usable}
                      onClick={() => {
                        edit(setSelectedKey)(candidate.path);
                        setKeyListOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg border p-3 text-left text-sm",
                        candidate.path === selectedKey ? "border-ring" : "border-border/50",
                        candidate.usable ? "cursor-pointer" : "cursor-not-allowed opacity-60",
                      )}
                    >
                      <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium text-foreground">{candidate.label}</span>
                        {candidate.keyType && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {candidate.keyType}
                          </span>
                        )}
                        <span className="block truncate font-mono text-[11px] text-muted-foreground/60">
                          {candidate.path}
                        </span>
                        {!candidate.usable && (
                          <span className="mt-1 block text-[11px] text-muted-foreground">
                            Unusable: it has a passphrase and no agent holds it. Run{" "}
                            <code>ssh-add {candidate.path}</code>, then scan again.
                          </span>
                        )}
                      </span>
                      {candidate.encrypted && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Lock className="h-3 w-3" />
                          {candidate.agentLoaded ? "agent ready" : "locked"}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              <p className="mt-1 text-[11px] text-muted-foreground/60">
                The key linked to the account above.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-9 text-muted-foreground"
              aria-label="Scan again"
              onClick={() => setScan((attempt) => attempt + 1)}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
        {(keysError !== null || keys?.length === 0) && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 text-muted-foreground"
            onClick={() => setScan((attempt) => attempt + 1)}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Scan again
          </Button>
        )}
      </div>

      <div className="mt-5">
        <button
          type="button"
          aria-expanded={advanced}
          onClick={() => setAdvanced((open) => !open)}
          className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronRight
            className={cn("h-3.5 w-3.5 transition-transform", advanced && "rotate-90")}
          />
          Advanced
        </button>

        {advanced && (
          <div className="mt-3 space-y-3">
            <div>
              <label
                htmlFor="server-port"
                className="mb-1.5 block text-xs font-medium text-muted-foreground"
              >
                Hive port
              </label>
              <Input
                id="server-port"
                value={port}
                onChange={(event) => edit(setPort)(event.target.value)}
                inputMode="numeric"
                className="w-32 font-mono text-xs"
              />
              <p className="mt-1 text-[11px] text-muted-foreground/60">
                Where the Hive backend serves.
              </p>
            </div>
            <div>
              <label
                htmlFor="install-dir"
                className="mb-1.5 block text-xs font-medium text-muted-foreground"
              >
                Install directory
              </label>
              <Input
                id="install-dir"
                value={installDir}
                onChange={(event) => edit(setInstallDir)(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="font-mono text-xs"
              />
              <p className="mt-1 text-[11px] text-muted-foreground/60">
                Hive and its private runtime live here.
              </p>
            </div>
            <div>
              <label
                htmlFor="data-dir"
                className="mb-1.5 block text-xs font-medium text-muted-foreground"
              >
                Data directory
              </label>
              <Input
                id="data-dir"
                value={dataDir}
                onChange={(event) => edit(setDataDir)(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="font-mono text-xs"
              />
              <p className="mt-1 text-[11px] text-muted-foreground/60">
                Projects, worktrees and sessions — the directory that grows.
              </p>
            </div>
          </div>
        )}
      </div>

      {phase !== "idle" && (
        <Pipeline
          phase={phase}
          failedStep={failedStep}
          error={error}
          identity={identity}
          report={report}
          connectedAs={`connected as ${user ?? "root"} with ${key?.label ?? "no key"}`}
          password={password}
          passwordRequired={passwordRequired}
          passwordUser={user ?? "root"}
          onPassword={setPassword}
        />
      )}
    </InstallerScreen>
  );
}

// ── the pipeline ─────────────────────────────────────────────────────────────

type StepStatus = "pending" | "running" | "done" | "action" | "failed";

function StepIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case "done":
      return <CheckCircle2 className="h-4.5 w-4.5 shrink-0 text-success" />;
    case "running":
      return <Spinner className="h-4.5 w-4.5 shrink-0 text-muted-foreground" />;
    case "action":
      return <ShieldQuestion className="h-4.5 w-4.5 shrink-0 text-primary" />;
    case "failed":
      return <XCircle className="h-4.5 w-4.5 shrink-0 text-destructive" />;
    default:
      return (
        <span
          aria-hidden
          className="m-0.5 block size-3.5 shrink-0 rounded-full border border-dashed border-muted-foreground/50"
        />
      );
  }
}

function Step({
  status,
  title,
  last,
  children,
}: {
  status: StepStatus;
  title: string;
  last?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <StepIcon status={status} />
        {!last && <div className="w-px flex-1 bg-border" />}
      </div>
      <div className={cn("min-w-0 flex-1", !last && "pb-4")}>
        <p
          className={cn(
            "text-sm font-medium",
            status === "pending" ? "text-muted-foreground/60" : "text-foreground",
          )}
        >
          {title}
        </p>
        {children}
      </div>
    </li>
  );
}

function ErrorCard({ error }: { error: ProvisionError }) {
  return (
    <div
      role="alert"
      className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
    >
      <p className="font-medium text-destructive">{error.code}</p>
      <p className="mt-1 text-xs text-muted-foreground">{provisionErrorHint(error.code)}</p>
      <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-2 font-mono text-[11px] text-muted-foreground">
        {error.detail}
      </pre>
    </div>
  );
}

/**
 * The check list, folded to one line when nothing blocks: a clean bill needs
 * no reading. A failure unfolds it on arrival, with the failing detail and
 * the field that corrects it.
 */
function Findings({ report }: { report: PreflightReport }) {
  const clear = canProceed(report);
  const failed = report.checks.filter((check) => check.status === "fail").length;
  const [open, setOpen] = useState(!clear);
  return (
    <div className="mt-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "inline-flex cursor-pointer items-center gap-1 text-xs hover:text-foreground",
          clear ? "text-muted-foreground" : "text-destructive",
        )}
      >
        <ChevronRight
          className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")}
        />
        {clear
          ? `All ${report.checks.length} checks passed`
          : `${failed} of ${report.checks.length} checks failed`}
      </button>
      {open && (
        <ul className="mt-1">
          {report.checks.map((finding) => (
            <Finding key={finding.check} check={finding} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Finding({ check }: { check: PreflightCheck }) {
  const field = check.status === "fail" ? correctableField(check.check) : undefined;
  const marker =
    check.status === "ok" ? (
      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
    ) : check.status === "warn" ? (
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    ) : (
      <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
    );
  return (
    <li className="flex items-start gap-2 py-1.5">
      {marker}
      <span className="min-w-0 flex-1 text-xs">
        <span className="font-medium text-foreground">{checkTitle(check.check)}</span>
        <span className="ml-2 text-muted-foreground">{check.detail}</span>
        {check.status === "fail" && (
          <span className="mt-0.5 block text-destructive">
            {field
              ? `Correct ${field}, then connect again.`
              : "This cannot be corrected from here — it has to be fixed on the server."}
          </span>
        )}
      </span>
    </li>
  );
}

function Pipeline({
  phase,
  failedStep,
  error,
  identity,
  report,
  connectedAs,
  password,
  passwordRequired,
  passwordUser,
  onPassword,
}: {
  phase: "reaching" | "approve" | "checking" | "report" | "failed";
  failedStep: "reach" | "check";
  error: ProvisionError | null;
  identity: HostIdentity | null;
  report: PreflightReport | null;
  connectedAs: string;
  password: string;
  passwordRequired: boolean;
  passwordUser: string;
  onPassword: (value: string) => void;
}) {
  const reachFailed = phase === "failed" && failedStep === "reach";
  const reach: StepStatus = phase === "reaching" ? "running" : reachFailed ? "failed" : "done";
  const verify: StepStatus =
    phase === "reaching" || reachFailed ? "pending" : phase === "approve" ? "action" : "done";
  const check: StepStatus =
    phase === "checking"
      ? "running"
      : phase === "report"
        ? report !== null && canProceed(report)
          ? "done"
          : "failed"
        : phase === "failed" && failedStep === "check"
          ? "failed"
          : "pending";

  return (
    <ol className="mt-6">
      <Step status={reach} title="Reach the server">
        {reach === "done" && <p className="text-xs text-muted-foreground">{connectedAs}</p>}
        {reachFailed && error && <ErrorCard error={error} />}
      </Step>

      <Step status={verify} title="Verify its identity">
        {verify === "action" && identity && (
          <>
            <p className="text-xs text-muted-foreground">
              First contact with this server. Confirm the fingerprint matches what your provider
              shows.
            </p>
            <p className="mt-1.5 break-all font-mono text-xs text-foreground">
              {identity.keyType} {identity.fingerprint}
            </p>
          </>
        )}
        {verify === "done" && identity && (
          <p className="text-xs text-muted-foreground">
            <span className="font-mono">{identity.fingerprint}</span>
            {identity.trusted ? " — already approved" : " — approved"}
          </p>
        )}
      </Step>

      <Step status={check} title="Check it is ready for Hive" last>
        {phase === "failed" && failedStep === "check" && error && <ErrorCard error={error} />}
        {phase === "report" && report && (
          <>
            <Findings report={report} />
            {!canProceed(report) && (
              <p role="alert" className="mt-2 text-xs text-destructive">
                The install cannot start until the findings above are cleared.
              </p>
            )}
            {passwordRequired && (
              <div className="mt-3">
                <label
                  htmlFor="escalation-password"
                  className="mb-1.5 block text-xs font-medium text-muted-foreground"
                >
                  Password for {passwordUser}
                </label>
                <Input
                  id="escalation-password"
                  type="password"
                  value={password}
                  onChange={(event) => onPassword(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-xs"
                />
                <p className="mt-1 text-[11px] text-muted-foreground/60">
                  This account needs a password to become root. It is used for this install only
                  and is never written to disk.
                </p>
              </div>
            )}
          </>
        )}
      </Step>
    </ol>
  );
}
