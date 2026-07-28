import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DEFAULT_BACKEND_PORT, isValidPort, switchServer } from "@/lib/server-connection";
import { openExternal } from "@/lib/open-external";

/** The prerequisites page an operator reads before starting. */
export const PREREQUISITES_URL =
  "https://github.com/unfence-labs/hive/blob/main/docs/prerequisites.md";

interface WelcomeScreenProps {
  /** Start the guided install. */
  onInstall: () => void;
  /** A server was configured from the inline form; dismiss the installer. */
  onConnected: () => void;
  /** Abandon the installer. Only offered when a server is already configured. */
  onCancel?: () => void;
}

/**
 * The first screen and the only exit. Either the installer puts Hive on a
 * server, or the operator points the app at a server that already exists —
 * that second path is the skip, so there is no separate skip control.
 */
export function WelcomeScreen({ onInstall, onConnected, onCancel }: WelcomeScreenProps) {
  const [showForm, setShowForm] = useState(false);
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
      <div className="flex-1">
        <h1 className="text-lg font-semibold text-foreground">Set up Hive</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Hive runs on a server you own. Install it on a fresh server, or point this app at one
          that is already running.
        </p>

        <div className="mt-6 space-y-3">
          <section className="rounded-lg border border-border/50 p-4">
            <h2 className="text-sm font-medium text-foreground">Install Hive on a server</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Connects over SSH and installs Hive on an Ubuntu 22.04/24.04 or Debian 12/13 server.
              Read the{" "}
              <button
                type="button"
                className="cursor-pointer underline underline-offset-2 hover:text-foreground"
                onClick={() => void openExternal(PREREQUISITES_URL)}
              >
                prerequisites
              </button>{" "}
              first — you arrange the private network yourself, if you want one.
            </p>
            <Button className="mt-3" onClick={onInstall}>
              Install on a server
            </Button>
          </section>

          <section className="rounded-lg border border-border/50 p-4">
            <h2 className="text-sm font-medium text-foreground">
              Connect to a server that already exists
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter its address and access token. Nothing is installed.
            </p>
            {showForm ? (
              <div className="mt-4 space-y-3">
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
                <div>
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
                {error && (
                  <p role="alert" className="text-xs text-destructive">
                    {error}
                  </p>
                )}
                <Button onClick={() => void connect()} disabled={!canConnect}>
                  {connecting ? "Connecting…" : "Connect"}
                </Button>
              </div>
            ) : (
              <Button variant="outline" className="mt-3" onClick={() => setShowForm(true)}>
                I already have a server
              </Button>
            )}
          </section>
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
