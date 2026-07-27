import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { InstallerScreen } from "./InstallerScreen";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import {
  isUsableAddress,
  isUsableDirectory,
  type InstallerInputs,
  type NetworkMode,
} from "@/pages/installer/machine";

interface NetworkScreenProps {
  inputs: InstallerInputs;
  onContinue: (values: Partial<InstallerInputs>) => void;
  onBack: () => void;
}

const MODES: Array<{ value: NetworkMode; title: string; detail: string }> = [
  {
    value: "tailnet",
    title: "Reachable only over a private network",
    detail:
      "Hive is opened on the private network interface only. Bring that network up yourself first, on the server and on this machine — Hive does not install or configure it.",
  },
  {
    value: "public",
    title: "Reachable at its public address",
    detail:
      "Hive is opened on its port and protected by the access token the install generates.",
  },
];

/**
 * The operator declares how the server will be exposed and where it lives.
 *
 * The mode selects how the install exposes the server, not how this app reaches
 * it: the address typed here is the one that reaches the server right now, and
 * it stays the address afterwards.
 */
export function NetworkScreen({ inputs, onContinue, onBack }: NetworkScreenProps) {
  const [mode, setMode] = useState<NetworkMode>(inputs.networkMode);
  const [address, setAddress] = useState(inputs.address);
  const [port, setPort] = useState(String(inputs.port));
  const [installDir, setInstallDir] = useState(inputs.installDir);
  const [dataDir, setDataDir] = useState(inputs.dataDir);
  const [tailnetInterface, setTailnetInterface] = useState(inputs.tailnetInterface);
  const [advanced, setAdvanced] = useState(false);

  const portNumber = Number(port);
  const portValid = Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65_535;
  const interfaceValid = mode !== "tailnet" || /^[A-Za-z0-9._-]+$/.test(tailnetInterface);
  const valid =
    isUsableAddress(address) &&
    portValid &&
    isUsableDirectory(installDir) &&
    isUsableDirectory(dataDir) &&
    interfaceValid;

  return (
    <InstallerScreen
      title="How the server is reached"
      description="Nothing here is guessed. Tell Hive how the server will be exposed and where it lives."
      onContinue={() =>
        onContinue({
          networkMode: mode,
          address: address.trim(),
          port: portNumber,
          installDir: installDir.trim(),
          dataDir: dataDir.trim(),
          tailnetInterface: tailnetInterface.trim(),
        })
      }
      continueDisabled={!valid}
      onBack={onBack}
    >
      <fieldset>
        <legend className="mb-2 text-xs font-medium text-muted-foreground">Exposure</legend>
        <RadioGroup value={mode} onValueChange={(value) => setMode(value as NetworkMode)}>
          {MODES.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/50 p-3 text-sm"
            >
              <RadioGroupItem
                value={option.value}
                aria-label={option.title}
                className="mt-0.5"
              />
              <span className="min-w-0 flex-1">
                <span className="font-medium text-foreground">{option.title}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{option.detail}</span>
              </span>
            </label>
          ))}
        </RadioGroup>
      </fieldset>

      <div className="mt-6 grid grid-cols-[1fr_120px] gap-3">
        <div>
          <label
            htmlFor="server-address"
            className="mb-1.5 block text-xs font-medium text-muted-foreground"
          >
            Address
          </label>
          <Input
            id="server-address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="root@203.0.113.10"
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-xs"
          />
          <p className="mt-1 text-[11px] text-muted-foreground/60">
            The address that reaches the server now, and the one Hive keeps using. Add{" "}
            <code>user@</code> to log in as something other than root.
          </p>
        </div>
        <div>
          <label
            htmlFor="server-port"
            className="mb-1.5 block text-xs font-medium text-muted-foreground"
          >
            Port
          </label>
          <Input
            id="server-port"
            value={port}
            onChange={(event) => setPort(event.target.value)}
            inputMode="numeric"
            className="font-mono text-xs"
          />
        </div>
      </div>

      <div className="mt-6">
        <button
          type="button"
          aria-expanded={advanced}
          onClick={() => setAdvanced((open) => !open)}
          className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", advanced && "rotate-90")} />
          Advanced
        </button>

        {advanced && (
          <div className="mt-3 space-y-3">
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
                onChange={(event) => setInstallDir(event.target.value)}
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
                onChange={(event) => setDataDir(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="font-mono text-xs"
              />
              <p className="mt-1 text-[11px] text-muted-foreground/60">
                Projects, worktrees and sessions — the directory that grows.
              </p>
            </div>
            {mode === "tailnet" && (
              <div>
                <label
                  htmlFor="tailnet-interface"
                  className="mb-1.5 block text-xs font-medium text-muted-foreground"
                >
                  Private network interface
                </label>
                <Input
                  id="tailnet-interface"
                  value={tailnetInterface}
                  onChange={(event) => setTailnetInterface(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-xs"
                />
                <p className="mt-1 text-[11px] text-muted-foreground/60">
                  Must already exist on the server. The connect step checks it.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </InstallerScreen>
  );
}
