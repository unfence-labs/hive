import { useState } from "react";
import { Bot, FolderGit2, MonitorSmartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HiveLogo } from "@/components/HiveLogo";
import { BackButton } from "./BackButton";
import { cn } from "@/lib/utils";
import { DEFAULT_BACKEND_PORT, isValidPort, switchServer } from "@/lib/server-connection";

interface WelcomeScreenProps {
  /**
   * Start the guided install. Absent in the web build, which has no SSH
   * sidecar to run it — connecting to an existing server is the only path.
   */
  onInstall?: () => void;
  /** A server was configured from the inline form; dismiss the installer. */
  onConnected: () => void;
  /** Abandon the installer. Only offered when a server is already configured. */
  onCancel?: () => void;
}

const FEATURES = [
  { icon: FolderGit2, text: "Work every repository in parallel workspaces" },
  { icon: Bot, text: "Run Claude Code, Codex and more, side by side" },
  { icon: MonitorSmartphone, text: "Start on your desktop, follow from your phone" },
] as const;

/**
 * The first screen and the only exit. Either the installer puts Hive on a
 * server, or the operator points the app at a server that already exists —
 * that second path is the skip, so there is no separate skip control.
 *
 * This screen sells; it never explains. Anything technical about the install
 * belongs to the steps that follow.
 */
export function WelcomeScreen({ onInstall, onConnected, onCancel }: WelcomeScreenProps) {
  // With no install path there is nothing to choose — go straight to the form.
  const [showForm, setShowForm] = useState(!onInstall);
  const [host, setHost] = useState("");
  const [port, setPort] = useState(String(DEFAULT_BACKEND_PORT));
  const [token, setToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const portNumber = Number(port);
  const canConnect = host.trim().length > 0 && isValidPort(portNumber) && !connecting;

  const connect = async () => {
    setConnecting(true);
    setError(null);
    try {
      await switchServer(
        {
          host: host.trim(),
          port: portNumber,
          authToken: token.trim() || undefined,
        },
        { verify: true },
      );
      onConnected();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The server could not be reached.");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-xl flex-col px-6 py-10">
      {/* Anchored from the top rather than centered: content below the hero
          changes height (state swap, error lines), and anchoring means that
          growth extends downward instead of re-centering the whole column. */}
      <div className="flex flex-1 flex-col items-center pt-[14vh]">
        <div className="relative flex w-full max-w-sm flex-col items-center gap-8 text-center">
          {/* Soft brand glow behind the mark — a touch of depth, never motion. */}
          <div
            aria-hidden
            className="pointer-events-none absolute -top-8 left-1/2 -z-10 size-72 -translate-x-1/2 rounded-full opacity-70 blur-3xl"
            style={{ background: "var(--hive-accent-glow)" }}
          />

          <div className="flex flex-col items-center gap-5">
            <HiveLogo className="h-[68px] w-auto" />
            <div className="flex flex-col gap-1.5">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                Welcome to Hive
              </h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Your fleet of coding agents, on a server you own.
              </p>
            </div>
          </div>

          {showForm ? (
            <div className="w-full text-left">
              <div className="grid grid-cols-[1fr_120px] gap-3">
                <div>
                  <label
                    htmlFor="existing-host"
                    className="mb-1.5 block text-xs font-medium text-muted-foreground"
                  >
                    Address
                  </label>
                  <Input
                    id="existing-host"
                    value={host}
                    onChange={(event) => setHost(event.target.value)}
                    placeholder="203.0.113.10"
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono text-xs"
                  />
                </div>
                <div>
                  <label
                    htmlFor="existing-port"
                    className="mb-1.5 block text-xs font-medium text-muted-foreground"
                  >
                    Port
                  </label>
                  <Input
                    id="existing-port"
                    value={port}
                    onChange={(event) => setPort(event.target.value)}
                    inputMode="numeric"
                    className="font-mono text-xs"
                  />
                </div>
              </div>
              <div className="mt-3">
                <label
                  htmlFor="existing-token"
                  className="mb-1.5 block text-xs font-medium text-muted-foreground"
                >
                  Access token
                </label>
                <Input
                  id="existing-token"
                  type="password"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="Paste the access token"
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-xs"
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && canConnect) void connect();
                  }}
                />
              </div>
              {/* Always mounted: reserving the line keeps the Connect button
                  from shifting when a one-line error appears. */}
              <p role="alert" className="mt-3 min-h-4 text-xs text-destructive">
                {error}
              </p>
              <div
                className={cn(
                  "mt-4 flex items-center",
                  onInstall ? "justify-between" : "justify-end",
                )}
              >
                {onInstall && <BackButton onClick={() => setShowForm(false)} />}
                <Button onClick={() => void connect()} disabled={!canConnect}>
                  {connecting ? "Connecting…" : "Connect"}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <ul className="flex flex-col gap-2.5 text-sm text-muted-foreground">
                {FEATURES.map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-center gap-2.5">
                    <Icon aria-hidden className="h-4 w-4 shrink-0 text-foreground/70" />
                    <span>{text}</span>
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap items-center justify-center gap-2.5">
                <Button onClick={onInstall} className="cursor-pointer">
                  Install on a server
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowForm(true)}
                  className="cursor-pointer"
                >
                  I already have a server
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      {onCancel && (
        <div className="mt-8 flex justify-end">
          <Button variant="ghost" size="sm" onClick={onCancel} className="text-muted-foreground">
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
