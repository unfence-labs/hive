import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Loader2, RefreshCw } from "lucide-react";
import { SettingsHeader } from "@/components/AppLayout";
import { CenterCard } from "@/components/CenterCard";
import { Button } from "@/components/ui/button";
import { api } from "@/hooks/useApi";
import { isDesktopShell } from "@/lib/is-desktop";
import { copyToClipboard } from "@/lib/clipboard";
import {
  checkForUpdatesNow,
  installCurrentUpdate,
  shouldCheckForUpdates,
  useDesktopUpdateState,
  type DesktopUpdateState,
} from "@/hooks/useDesktopUpdate";

/**
 * The desktop build's own version; the web app has none of its own. Asked from
 * Rust because the JS-side `getVersion()` reports the numeric macOS bundle
 * version, which drops prerelease suffixes like `-beta.5`.
 */
function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    if (!isDesktopShell()) return;
    let active = true;
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<string>("app_version"))
      .then((v) => {
        if (active) setVersion(v);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return version;
}

export default function UpdatesSettings() {
  const appVersion = useAppVersion();
  const backendQuery = useQuery({
    queryKey: ["server", "version"],
    queryFn: () => api.get<{ version: string }>("/api/server/version"),
  });

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <SettingsHeader>
        <h1 className="text-sm font-medium">Updates</h1>
      </SettingsHeader>

      <CenterCard scroll>
        <div className="max-w-2xl space-y-6 px-4 py-5">
          {isDesktopShell() && <AppSection appVersion={appVersion} />}
          <ServerSection
            appVersion={appVersion}
            backendVersion={backendQuery.data?.version ?? null}
            unreachable={backendQuery.isError}
          />
        </div>
      </CenterCard>
    </div>
  );
}

function AppSection({ appVersion }: { appVersion: string | null }) {
  const update = useDesktopUpdateState();
  const busy =
    update.phase === "checking" || update.phase === "downloading" || update.phase === "installing";

  return (
    <section className="rounded-lg border border-border/50 bg-card/50 p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">Application</h2>
          <p className="mt-1 text-xs text-muted-foreground">Version {appVersion ?? "—"}</p>
        </div>
        {shouldCheckForUpdates() && (
          <Button size="sm" variant="outline" onClick={checkForUpdatesNow} disabled={busy}>
            {update.phase === "checking" ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            Check for updates
          </Button>
        )}
      </div>
      {shouldCheckForUpdates() ? (
        <UpdateStatus update={update} />
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          Update checks run in installed builds only.
        </p>
      )}
    </section>
  );
}

function UpdateStatus({ update }: { update: DesktopUpdateState }) {
  switch (update.phase) {
    case "upToDate":
      return <p className="mt-2 text-xs text-muted-foreground">You're on the latest version.</p>;
    case "checkFailed":
      return (
        <p className="mt-2 text-xs text-destructive">Update check failed: {update.error}</p>
      );
    case "available":
      return (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-border/50 bg-muted/40 px-3 py-2">
          <p className="text-xs text-foreground">Version {update.version} is available.</p>
          <Button size="sm" onClick={installCurrentUpdate}>
            Restart & update
          </Button>
        </div>
      );
    case "downloading":
      return (
        <p className="mt-2 text-xs text-muted-foreground">
          Downloading {update.version}…{update.percent !== null ? ` ${update.percent}%` : ""}
        </p>
      );
    case "installing":
      return <p className="mt-2 text-xs text-muted-foreground">Installing {update.version}…</p>;
    case "failed":
      return (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-destructive">Update failed: {update.error}</p>
          <Button size="sm" variant="outline" onClick={installCurrentUpdate}>
            Retry
          </Button>
        </div>
      );
    default:
      return null;
  }
}

function ServerSection({
  appVersion,
  backendVersion,
  unreachable,
}: {
  appVersion: string | null;
  backendVersion: string | null;
  unreachable: boolean;
}) {
  // The desktop version is the reference: releases version both artifacts
  // together, so a differing backend is one an operator has not updated yet.
  const outdated =
    appVersion !== null &&
    backendVersion !== null &&
    backendVersion !== "dev" &&
    backendVersion !== appVersion;

  return (
    <section className="rounded-lg border border-border/50 bg-card/50 p-5">
      <h2 className="text-sm font-medium text-foreground">Server</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Version {unreachable ? "unavailable" : (backendVersion ?? "—")}
      </p>
      {outdated && (
        <>
          <p className="mt-2 text-xs text-muted-foreground">
            The server is not on the app's version. Update it from a server shell:
          </p>
          <UpdateCommand version={appVersion} />
        </>
      )}
    </section>
  );
}

function UpdateCommand({ version }: { version: string }) {
  const [copied, setCopied] = useState(false);
  const command = `curl -fsSL https://github.com/unfence-labs/hive/releases/download/v${version}/provision.sh | sudo bash -s -- --update`;

  return (
    <div className="mt-2 flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
        {command}
      </code>
      <Button
        size="sm"
        variant="ghost"
        aria-label="Copy update command"
        onClick={() => {
          void copyToClipboard(command);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}
