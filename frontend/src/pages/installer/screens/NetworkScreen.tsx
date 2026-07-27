import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { InstallerScreen } from "./InstallerScreen";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  isUsableAddress,
  isUsableDirectory,
  type InstallerInputs,
} from "@/pages/installer/machine";

interface NetworkScreenProps {
  inputs: InstallerInputs;
  onContinue: (values: Partial<InstallerInputs>) => void;
  onBack: () => void;
}

/**
 * Where the server lives, and nothing more.
 *
 * The operator is deliberately not asked how their server is reachable. That is
 * theirs to arrange — a public address, a VPN, a private NIC — and the backend
 * binds every interface either way. The address typed here is the one that
 * reaches the server right now, and it stays the address afterwards.
 */
export function NetworkScreen({ inputs, onContinue, onBack }: NetworkScreenProps) {
  const [address, setAddress] = useState(inputs.address);
  const [port, setPort] = useState(String(inputs.port));
  const [installDir, setInstallDir] = useState(inputs.installDir);
  const [dataDir, setDataDir] = useState(inputs.dataDir);
  const [advanced, setAdvanced] = useState(false);

  const portNumber = Number(port);
  const portValid = Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65_535;
  const valid =
    isUsableAddress(address) &&
    portValid &&
    isUsableDirectory(installDir) &&
    isUsableDirectory(dataDir);

  return (
    <InstallerScreen
      title="Where the server is"
      description="The address that reaches your server, and the port Hive should listen on. How you make it reachable is your business — Hive does not ask and does not arrange it."
      onContinue={() =>
        onContinue({
          address: address.trim(),
          port: portNumber,
          installDir: installDir.trim(),
          dataDir: dataDir.trim(),
        })
      }
      continueDisabled={!valid}
      onBack={onBack}
    >
      <div className="grid grid-cols-[1fr_120px] gap-3">
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
          </div>
        )}
      </div>
    </InstallerScreen>
  );
}
