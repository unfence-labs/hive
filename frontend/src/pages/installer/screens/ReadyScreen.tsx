import {
  Bot,
  Box,
  Database,
  KeyRound,
  Package,
  Play,
  ShieldCheck,
  Undo2,
  UserRound,
} from "lucide-react";
import { InstallerScreen } from "./InstallerScreen";
import { parseAddress, type InstallerInputs } from "@/pages/installer/machine";

interface ReadyScreenProps {
  inputs: InstallerInputs;
  /** The install will escalate with the password collected on the server step. */
  escalates: boolean;
  /** Start the install. Past this point there is no way out but through. */
  onContinue: () => void;
  onBack: () => void;
}

/**
 * The settled plan, restated before anything on the server is touched. This is
 * the last screen where going back is free: the next one runs the install.
 *
 * The manifest below is the screen's real content: an operator about to hand
 * root to a script deserves the exact footprint, negatives included. Keep it
 * in lockstep with `scripts/provision/steps.sh` — it is a promise, not prose.
 */
export function ReadyScreen({ inputs, escalates, onContinue, onBack }: ReadyScreenProps) {
  const { host, user } = parseAddress(inputs.address);
  const summary: Array<[string, string]> = [
    ["Server", `${user ?? "root"}@${host}`],
    ["SSH key", inputs.sshKeyPath ?? "—"],
    [
      "Root access",
      escalates ? "sudo, with the password you entered" : "direct, no password needed",
    ],
  ];

  const actions = [
    {
      icon: Package,
      text: (
        <>
          Installs a handful of base packages with <code>apt</code> — git, curl, certificates.
        </>
      ),
    },
    {
      icon: UserRound,
      text: (
        <>
          Creates the <code>hive</code> service account and authorizes your key on it — editor
          and terminal sessions connect as <code>hive</code>.
        </>
      ),
    },
    {
      icon: Box,
      text: (
        <>
          Puts the Hive backend and a private Node.js runtime in <code>{inputs.installDir}</code>{" "}
          — the system Node is never touched.
        </>
      ),
    },
    {
      icon: Bot,
      text: (
        <>
          Installs Claude Code, Codex, the GitHub CLI and the <code>agent-browser</code>{" "}
          automation tool inside that prefix, for the <code>hive</code> account only — plus a
          Chrome build under that account's home and the system libraries it needs.
        </>
      ),
    },
    {
      icon: Database,
      text: (
        <>
          Creates <code>{inputs.dataDir}</code> for projects, worktrees and sessions — the
          directory that grows.
        </>
      ),
    },
    {
      icon: KeyRound,
      text: (
        <>
          Generates the access token and keeps only its SHA-256 digest on the server. After a
          successful install, the desktop app stores the plaintext token in its local connection.
        </>
      ),
    },
    {
      icon: Play,
      text: (
        <>
          Installs the <code>hive</code> systemd service and starts it on port {inputs.port}.
        </>
      ),
    },
    {
      icon: ShieldCheck,
      text: (
        <>
          Adds <code>ufw allow {inputs.port}/tcp</code> only if ufw is already active — it never
          enables or reconfigures a firewall.
        </>
      ),
    },
    {
      icon: Undo2,
      text: (
        <>
          Writes <code>hive-uninstall.sh</code> on the server, so everything above can be undone.
        </>
      ),
    },
  ];

  return (
    <InstallerScreen
      title="Ready to install"
      description="Preflight passed: the server answered, its identity is approved, and nothing blocks the install. Everything the script will touch is listed below."
      onContinue={onContinue}
      continueLabel="Start the install"
      onBack={onBack}
    >
      <dl className="divide-y divide-border/40 text-sm">
        {summary.map(([label, value]) => (
          <div key={label} className="flex items-baseline gap-4 py-2">
            <dt className="w-24 shrink-0 text-xs text-muted-foreground">{label}</dt>
            <dd className="min-w-0 flex-1 break-all font-mono text-xs text-foreground">{value}</dd>
          </div>
        ))}
      </dl>

      <h2 className="mt-6 text-sm font-medium text-foreground">What the install does</h2>
      <ul className="mt-2 space-y-2.5">
        {actions.map(({ icon: Icon, text }, index) => (
          <li key={index} className="flex items-start gap-2.5 text-xs text-muted-foreground">
            <Icon aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/70" />
            <span className="min-w-0 flex-1 [&_code]:font-mono [&_code]:text-foreground">
              {text}
            </span>
          </li>
        ))}
      </ul>
    </InstallerScreen>
  );
}
