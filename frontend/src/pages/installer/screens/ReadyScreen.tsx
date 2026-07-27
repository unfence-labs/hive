import { InstallerScreen } from "./InstallerScreen";
import { parseAddress, type InstallerInputs } from "@/pages/installer/machine";

interface ReadyScreenProps {
  inputs: InstallerInputs;
  /** The install will escalate with the password collected on the connect step. */
  escalates: boolean;
  /** Start the install. Past this point there is no way out but through. */
  onContinue: () => void;
  onBack: () => void;
}

/**
 * The settled plan, restated before anything on the server is touched. This is
 * the last screen where going back is free: the next one runs the install.
 */
export function ReadyScreen({ inputs, escalates, onContinue, onBack }: ReadyScreenProps) {
  const { host, user } = parseAddress(inputs.address);
  const rows: Array<[string, string]> = [
    ["Server", `${user ?? "root"}@${host}`],
    ["Backend port", String(inputs.port)],
    [
      "Firewall rule",
      inputs.firewallInterface
        ? `Only on ${inputs.firewallInterface}, if a firewall is active`
        : `Port ${inputs.port} opened, if a firewall is active`,
    ],
    ["Install directory", inputs.installDir],
    ["Data directory", inputs.dataDir],
    ["SSH key", inputs.sshKeyPath ?? "—"],
    ["Approved fingerprint", inputs.fingerprint ?? "—"],
    [
      "Root access",
      escalates ? "sudo, with the password you entered" : "direct, no password needed",
    ],
  ];

  return (
    <InstallerScreen
      title="Ready to install"
      description="The server answered, its identity is approved, and the installer found nothing that blocks it. Starting the install changes the server; it runs to the end, and there is no cancel."
      onContinue={onContinue}
      continueLabel="Start the install"
      onBack={onBack}
    >
      <dl className="divide-y divide-border/40 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline gap-4 py-2">
            <dt className="w-44 shrink-0 text-xs text-muted-foreground">{label}</dt>
            <dd className="min-w-0 flex-1 break-all font-mono text-xs text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </InstallerScreen>
  );
}
