import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { InstallerScreen } from "./InstallerScreen";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { isValidPort } from "@/lib/server-connection";
import { openExternal } from "@/lib/open-external";
import {
  isUsableAddress,
  isUsableDirectory,
  type InstallerInputs,
} from "@/pages/installer/machine";

/** Explains the reachability paths — Tailscale, VPN, a hardened public IP. */
export const NETWORKING_GUIDE_URL =
  "https://github.com/unfence-labs/hive/blob/main/docs/networking.md";

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
 *
 * The install only needs an SSH address, so that is the whole form. Hive's own
 * port is an Advanced detail: it is where the backend will serve, not anything
 * the install connects to.
 */
export function NetworkScreen({ inputs, onContinue, onBack }: NetworkScreenProps) {
  const [address, setAddress] = useState(inputs.address);
  const [port, setPort] = useState(String(inputs.port));
  const [installDir, setInstallDir] = useState(inputs.installDir);
  const [dataDir, setDataDir] = useState(inputs.dataDir);
  const [advanced, setAdvanced] = useState(false);

  const portNumber = Number(port);
  const valid =
    isUsableAddress(address) &&
    isValidPort(portNumber) &&
    isUsableDirectory(installDir) &&
    isUsableDirectory(dataDir);

  return (
    <InstallerScreen
      title="Where do you ssh?"
      description={
        <>
          Hive installs itself over SSH. Type the address exactly as you would after{" "}
          <code className="font-mono text-xs text-foreground">ssh</code> — a public IP, a
          Tailscale name, anything that reaches the box.
        </>
      }
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
          onChange={(event) => setAddress(event.target.value)}
          placeholder="root@203.0.113.10"
          autoComplete="off"
          spellCheck={false}
          className="w-full bg-transparent pl-2 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground/60">
        Your network, your rules — Tailscale, VPN, or a public address you harden yourself.{" "}
        <button
          type="button"
          className="cursor-pointer underline underline-offset-2 hover:text-foreground"
          onClick={() => void openExternal(NETWORKING_GUIDE_URL)}
        >
          Networking guide ↗
        </button>
      </p>

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
                htmlFor="server-port"
                className="mb-1.5 block text-xs font-medium text-muted-foreground"
              >
                Hive port
              </label>
              <Input
                id="server-port"
                value={port}
                onChange={(event) => setPort(event.target.value)}
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
