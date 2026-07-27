import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { InstallerScreen } from "./InstallerScreen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  provisionErrorHint,
  toProvisionError,
  type HostIdentity,
  type PreflightCheck,
  type PreflightReport,
  type ProvisionClient,
  type ProvisionError,
} from "@/lib/provision-client";
import { parseAddress, type InstallerInputs } from "@/pages/installer/machine";
import {
  canProceed,
  checkTitle,
  correctableField,
  firewallRuleWillBeWritten,
  needsEscalationPassword,
  serverInterfaces,
} from "@/pages/installer/preflight";

interface ConnectScreenProps {
  client: ProvisionClient;
  inputs: InstallerInputs;
  /** Hands the install everything it needs, including the escalation password. */
  onContinue: (values: Partial<InstallerInputs>, password?: string) => void;
  onBack: () => void;
}

type Phase = "scanning" | "approve" | "preflighting" | "report" | "failed";

const STATUS_ICON = {
  ok: <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />,
  warn: <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />,
  fail: <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />,
};

function Finding({ check }: { check: PreflightCheck }) {
  const field = check.status === "fail" ? correctableField(check.check) : undefined;
  return (
    <li className="flex items-start gap-2 py-2 text-sm">
      {STATUS_ICON[check.status]}
      <span className="min-w-0 flex-1">
        <span className="font-medium text-foreground">{checkTitle(check.check)}</span>
        <span className="block text-xs text-muted-foreground">{check.detail}</span>
        {check.status === "fail" && (
          <span className="mt-1 block text-xs text-destructive">
            {field
              ? `Go back and correct ${field}, then test again.`
              : "This cannot be corrected from here — it has to be fixed on the server."}
          </span>
        )}
      </span>
    </li>
  );
}

/**
 * Reach the server, approve its identity, and run the script's own preflight
 * over that same connection.
 *
 * Everything correctable is reported here, while the form is still editable.
 * That is what makes the install step tenable: once it starts, there is nothing
 * left for the operator to fix.
 */
export function ConnectScreen({ client, inputs, onContinue, onBack }: ConnectScreenProps) {
  const { host, user } = parseAddress(inputs.address);
  const [phase, setPhase] = useState<Phase>("scanning");
  const [identity, setIdentity] = useState<HostIdentity | null>(null);
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [error, setError] = useState<ProvisionError | null>(null);
  const [password, setPassword] = useState("");
  const [attempt, setAttempt] = useState(0);
  // The empty string is "open the port to everyone"; anything else names the
  // interface the one rule is scoped to. It is only ever one of the interfaces
  // the report below enumerated, which is why a missing interface can no longer
  // be asked for.
  const [firewallInterface, setFirewallInterface] = useState("");

  const runPreflight = useCallback(async () => {
    setPhase("preflighting");
    setError(null);
    // A fresh report may describe a different firewall and a different set of
    // interfaces, so a choice made against the previous one is discarded.
    setFirewallInterface("");
    try {
      const result = await client.preflight(
        { host, ...(user ? { user } : {}), keyPath: inputs.sshKeyPath ?? "" },
        {
          port: inputs.port,
          installDir: inputs.installDir,
          dataDir: inputs.dataDir,
          ...(inputs.sshPublicKey ? { sshPublicKey: inputs.sshPublicKey } : {}),
        },
      );
      setReport(result);
      setPhase("report");
    } catch (caught: unknown) {
      setError(toProvisionError(caught));
      setPhase("failed");
    }
  }, [
    client,
    host,
    inputs.dataDir,
    inputs.installDir,
    inputs.port,
    inputs.sshKeyPath,
    inputs.sshPublicKey,
    user,
  ]);

  // Scan on arrival, and again on every explicit retry. Both steps are
  // read-only, so re-running them costs nothing and changes nothing.
  useEffect(() => {
    let cancelled = false;
    setPhase("scanning");
    setError(null);
    setReport(null);
    client
      .testConnection(host)
      .then((found) => {
        if (cancelled) return;
        setIdentity(found);
        if (found.trusted) void runPreflight();
        else setPhase("approve");
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(toProvisionError(caught));
        setPhase("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, client, host, runPreflight]);

  const approve = async () => {
    if (!identity) return;
    setPhase("preflighting");
    try {
      await client.trustHost(host, identity.hostKey);
    } catch (caught: unknown) {
      setError(toProvisionError(caught));
      setPhase("failed");
      return;
    }
    await runPreflight();
  };

  const passwordRequired = report !== null && needsEscalationPassword(report);
  const ready =
    phase === "report" && report !== null && canProceed(report) && (!passwordRequired || password !== "");

  // The one firewall question, and the only place it is asked. It exists only
  // when this server runs a firewall the installer will actually write a rule
  // to, and it offers only interfaces this server actually has.
  const interfaces = report ? serverInterfaces(report) : [];
  const asksAboutFirewall =
    phase === "report" &&
    report !== null &&
    canProceed(report) &&
    firewallRuleWillBeWritten(report) &&
    interfaces.length > 0;

  const primary =
    phase === "approve"
      ? { label: "Approve and check the server", action: () => void approve(), disabled: false }
      : phase === "report"
        ? {
            label: "Continue",
            action: () =>
              onContinue(
                {
                  hostKey: identity?.hostKey,
                  fingerprint: identity?.fingerprint,
                  // Carried forward so a relaunch knows whether the install can
                  // resume on its own or has to ask for the password again.
                  privilegeMode: report?.privilege.mode,
                  // Always written, never merged: a server whose firewall is
                  // not the one an earlier attempt saw must not inherit that
                  // attempt's answer.
                  firewallInterface:
                    asksAboutFirewall && firewallInterface !== "" ? firewallInterface : undefined,
                },
                passwordRequired ? password : undefined,
              ),
            disabled: !ready,
          }
        : null;

  return (
    <InstallerScreen
      title="Check the server"
      description="Hive reaches the server, confirms which server it is, and asks the installer what it would find there. Nothing is changed."
      onContinue={primary ? primary.action : undefined}
      continueLabel={primary?.label}
      continueDisabled={primary?.disabled}
      onBack={onBack}
      footer={
        phase === "failed" ? (
          <Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>
            Try again
          </Button>
        ) : undefined
      }
    >
      <p className="text-xs text-muted-foreground">
        Connecting to <span className="font-mono text-foreground">{user ?? "root"}@{host}</span> on
        port 22 with{" "}
        <span className="font-mono text-foreground">{inputs.sshKeyPath ?? "no key"}</span>.
      </p>

      {(phase === "scanning" || phase === "preflighting") && (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" />
          {phase === "scanning" ? "Reaching the server…" : "Checking the server…"}
        </div>
      )}

      {phase === "failed" && error && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"
        >
          <p className="font-medium text-destructive">{error.code}</p>
          <p className="mt-1 text-muted-foreground">{provisionErrorHint(error.code)}</p>
          <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-2 font-mono text-[11px] text-muted-foreground">
            {error.detail}
          </pre>
        </div>
      )}

      {phase === "approve" && identity && (
        <div className="mt-4 rounded-lg border border-border/50 bg-card/50 p-4">
          <div className="flex items-center gap-2 text-sm">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <span className="text-muted-foreground">
              This server has not been approved yet. Confirm its fingerprint matches what your
              provider shows.
            </span>
          </div>
          <p className="mt-3 break-all font-mono text-xs text-foreground">
            {identity.keyType} {identity.fingerprint}
          </p>
        </div>
      )}

      {phase === "report" && report && (
        <div className="mt-4">
          {identity?.trusted && (
            <p className="text-xs text-muted-foreground">
              Server identity already approved:{" "}
              <span className="font-mono">{identity.fingerprint}</span>
            </p>
          )}
          <ul className="mt-2 divide-y divide-border/40">
            {report.checks.map((check) => (
              <Finding key={check.check} check={check} />
            ))}
          </ul>

          {!canProceed(report) && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              The install cannot start until the findings above are cleared.
            </p>
          )}

          {asksAboutFirewall && (
            <fieldset className="mt-4">
              <legend className="mb-1 text-xs font-medium text-muted-foreground">
                This server runs an active firewall
              </legend>
              <p className="mb-2 text-xs text-muted-foreground">
                Hive will add one rule to it and change nothing else — not the default policy, not
                any rule you wrote.
              </p>
              <RadioGroup
                value={firewallInterface}
                onValueChange={setFirewallInterface}
                className="max-h-56 overflow-auto"
              >
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/50 p-3 text-sm">
                  <RadioGroupItem
                    value=""
                    aria-label={`Open port ${inputs.port} to anything that can reach this server`}
                    className="mt-0.5"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-foreground">
                      Open port {inputs.port} to anything that can reach this server
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      The access token stays the protection either way.
                    </span>
                  </span>
                </label>
                {interfaces.map((entry) => (
                  <label
                    key={entry.name}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/50 p-3 text-sm"
                  >
                    <RadioGroupItem
                      value={entry.name}
                      aria-label={`Allow it only on ${entry.name}`}
                      className="mt-0.5"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-foreground">
                        Allow it only on {entry.name}
                      </span>
                      <span className="mt-1 block break-all font-mono text-xs text-muted-foreground">
                        {entry.addresses.join(", ") || "no address"}
                      </span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </fieldset>
          )}

          {passwordRequired && (
            <div className="mt-4">
              <label
                htmlFor="escalation-password"
                className="mb-1.5 block text-xs font-medium text-muted-foreground"
              >
                Password for {user ?? "root"}
              </label>
              <Input
                id="escalation-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="font-mono text-xs"
              />
              <p className="mt-1 text-[11px] text-muted-foreground/60">
                This account needs a password to become root. It is used for this install only and
                is never written to disk.
              </p>
            </div>
          )}
        </div>
      )}
    </InstallerScreen>
  );
}
