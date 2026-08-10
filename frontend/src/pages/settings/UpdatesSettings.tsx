import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Loader2, RefreshCw } from "lucide-react";
import { SettingsHeader } from "@/components/AppLayout";
import { CenterCard } from "@/components/CenterCard";
import { SettingsPanel, SettingsSection } from "@/components/settings/SettingsSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/hooks/useApi";
import { useAppVersion } from "@/hooks/useAppVersion";
import { replaceConnection, useConnection } from "@/hooks/useConnection";
import { useWorkspaceLiveDataContext } from "@/contexts/WorkspaceLiveDataContext";
import { isDesktopShell } from "@/lib/is-desktop";
import { copyToClipboard } from "@/lib/clipboard";
import { createTauriProvisionClient, type SshKey } from "@/lib/provision-client";
import {
  runServerUpdate,
  serverVersionDiffersFromApp,
  useServerUpdateState,
  type ServerUpdateState,
} from "@/lib/server-update";
import {
  checkForUpdatesNow,
  installCurrentUpdate,
  shouldCheckForUpdates,
  useDesktopUpdateState,
  type DesktopUpdateState,
} from "@/hooks/useDesktopUpdate";

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
        <SettingsPanel>
          {isDesktopShell() && <AppSection appVersion={appVersion} />}
          <ServerSection
            appVersion={appVersion}
            backendVersion={backendQuery.data?.version ?? null}
            unreachable={backendQuery.isError}
          />
        </SettingsPanel>
      </CenterCard>
    </div>
  );
}

function AppSection({ appVersion }: { appVersion: string | null }) {
  const update = useDesktopUpdateState();
  const canCheck = shouldCheckForUpdates();
  const busy =
    update.phase === "checking" || update.phase === "downloading" || update.phase === "installing";

  return (
    <SettingsSection
      title="Application"
      description={`Version ${appVersion ?? "—"}`}
      action={
        canCheck && (
          <Button size="sm" variant="outline" onClick={checkForUpdatesNow} disabled={busy}>
            {update.phase === "checking" ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            Check for updates
          </Button>
        )
      }
    >
      {canCheck ? (
        <UpdateStatus update={update} />
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          Update checks run in installed builds only.
        </p>
      )}
    </SettingsSection>
  );
}

function UpdateStatus({ update }: { update: DesktopUpdateState }) {
  // Installing ends in relaunch(), which would kill a provisioning run's SSH.
  const serverBusy = useServerUpdateState().phase === "running";
  switch (update.phase) {
    case "upToDate":
      return <p className="mt-3 text-xs text-muted-foreground">You're on the latest version.</p>;
    case "checkFailed":
      return (
        <p className="mt-3 text-xs text-destructive">Update check failed: {update.error}</p>
      );
    case "available":
      return (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-foreground">Version {update.version} is available.</p>
          <Button size="sm" onClick={installCurrentUpdate} disabled={serverBusy}>
            Restart & update
          </Button>
        </div>
      );
    case "downloading":
      return (
        <p className="mt-3 text-xs text-muted-foreground">
          Downloading {update.version}…{update.percent !== null ? ` ${update.percent}%` : ""}
        </p>
      );
    case "installing":
      return <p className="mt-3 text-xs text-muted-foreground">Installing {update.version}…</p>;
    case "failed":
      return (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-destructive">Update failed: {update.error}</p>
          <Button size="sm" variant="outline" onClick={installCurrentUpdate} disabled={serverBusy}>
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
  // The null re-check narrows appVersion for the JSX below.
  const outdated = appVersion !== null && serverVersionDiffersFromApp(appVersion, backendVersion);

  return (
    <SettingsSection
      title="Server"
      description={`Version ${unreachable ? "unavailable" : (backendVersion ?? "—")}`}
    >
      {/* `outdated` needs the app version, so this is desktop-only by construction. */}
      {outdated && <ServerUpdateFlow targetVersion={appVersion} />}
    </SettingsSection>
  );
}

/**
 * The in-app path: `provision.sh --update` over the SSH sidecar, using the key
 * the install stored (or asking for it once on older connections) and asking
 * for the escalation password only when the server's sudo mode requires it.
 */
function ServerUpdateFlow({ targetVersion }: { targetVersion: string }) {
  const desktopUpdate = useDesktopUpdateState();
  const updateState = useServerUpdateState();
  const { connection } = useConnection();
  const liveData = useWorkspaceLiveDataContext();
  const queryClient = useQueryClient();
  const client = useMemo(() => createTauriProvisionClient(), []);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [keyPicker, setKeyPicker] = useState<{ open: boolean; keys: SshKey[] }>({
    open: false,
    keys: [],
  });
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [password, setPassword] = useState("");

  // The app update comes first: the bundled provisioner installs the app's own
  // version, so updating the server before the app would converge on the old
  // one. A run already in flight keeps its progress visible regardless.
  const appUpdatePending =
    desktopUpdate.phase === "available" ||
    desktopUpdate.phase === "downloading" ||
    desktopUpdate.phase === "installing";
  if (!connection) return null;
  if (appUpdatePending && updateState.phase !== "running") return null;

  // Live WS state, not the projects query: status transitions do not
  // invalidate the projects list, whose snapshot can miss a running agent.
  const busyWorkspaces = Object.values(liveData).filter(
    (workspace) => workspace.status === "busy",
  ).length;

  const launch = async (keyPath: string, escalationPassword?: string) => {
    const result = await runServerUpdate(client, {
      host: connection.host,
      user: connection.adminUser,
      keyPath,
      password: escalationPassword,
    });
    if (result.phase === "failed" && result.passwordRequired) {
      setPasswordOpen(true);
      return;
    }
    if (result.phase === "done") {
      void queryClient.invalidateQueries({ queryKey: ["server", "version"] });
    }
  };

  const begin = async (escalationPassword?: string) => {
    if (connection.sshKeyPath) {
      void launch(connection.sshKeyPath, escalationPassword);
      return;
    }
    // Connections stored before the key path existed: ask once, then keep it.
    // No password can reach this branch: the password prompt only follows a
    // launch, and a launch requires a key — which pickKey persists first.
    const keys = (await client.listKeys().catch(() => [])).filter((key) => key.usable);
    setKeyPicker({ open: true, keys });
  };

  const requestUpdate = () => {
    if (busyWorkspaces > 0) setConfirmOpen(true);
    else void begin();
  };

  const pickKey = (key: SshKey) => {
    setKeyPicker({ open: false, keys: [] });
    replaceConnection({ ...connection, sshKeyPath: key.path });
    void launch(key.path);
  };

  const submitPassword = () => {
    setPasswordOpen(false);
    const submitted = password;
    setPassword("");
    void begin(submitted);
  };

  return (
    <>
      <ServerUpdateStatus
        targetVersion={targetVersion}
        state={updateState}
        onUpdate={requestUpdate}
      />

      <AgentsRunningDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        busyWorkspaces={busyWorkspaces}
        onConfirm={() => void begin()}
      />

      <SshKeyPickerDialog
        open={keyPicker.open}
        onOpenChange={(open) => !open && setKeyPicker({ open: false, keys: [] })}
        keys={keyPicker.keys}
        onPick={pickKey}
      />

      <EscalationPasswordDialog
        open={passwordOpen}
        onOpenChange={setPasswordOpen}
        adminUser={connection.adminUser}
        password={password}
        onPasswordChange={setPassword}
        onSubmit={submitPassword}
      />
    </>
  );
}

/** Presentation only: the run itself stays in {@link ServerUpdateFlow} above. */
function ServerUpdateStatus({
  targetVersion,
  state,
  onUpdate,
}: {
  targetVersion: string;
  state: ServerUpdateState;
  onUpdate: () => void;
}) {
  return (
    <>
      {state.phase === "running" ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {state.step}
        </p>
      ) : state.phase === "done" ? (
        <p className="mt-3 text-xs text-muted-foreground">Server updated.</p>
      ) : (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            The server is not on the app's version.
          </p>
          <Button size="sm" onClick={onUpdate}>
            Update server to {targetVersion}
          </Button>
        </div>
      )}
      {state.phase === "failed" && !state.passwordRequired && (
        <>
          <p className="mt-2 text-xs text-destructive">Update failed: {state.error}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Fallback, from a server shell:
          </p>
          <UpdateCommand version={targetVersion} />
        </>
      )}
    </>
  );
}

function AgentsRunningDialog({
  open,
  onOpenChange,
  busyWorkspaces,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busyWorkspaces: number;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Agents are running</AlertDialogTitle>
          <AlertDialogDescription>
            {busyWorkspaces} workspace{busyWorkspaces === 1 ? " has" : "s have"} agents running.
            Updating restarts the server and stops them.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Update anyway</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function SshKeyPickerDialog({
  open,
  onOpenChange,
  keys,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keys: SshKey[];
  onPick: (key: SshKey) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Select an SSH key</DialogTitle>
          <DialogDescription>
            The key used to install this server. It is remembered for future updates.
          </DialogDescription>
        </DialogHeader>
        {keys.length === 0 ? (
          <p className="text-xs text-muted-foreground">No usable SSH key found in ~/.ssh.</p>
        ) : (
          <div className="space-y-1">
            {keys.map((key) => (
              <button
                key={key.path}
                type="button"
                onClick={() => onPick(key)}
                className="flex w-full items-center gap-2 rounded-md border border-border/50 px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
              >
                <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{key.label}</span>
                {key.keyType && (
                  <span className="text-xs text-muted-foreground">{key.keyType}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EscalationPasswordDialog({
  open,
  onOpenChange,
  adminUser,
  password,
  onPasswordChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  adminUser: string | undefined;
  password: string;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Escalation password</DialogTitle>
          <DialogDescription>
            {adminUser ?? "root"} needs a password to escalate on the server. It is used for this
            run only and never stored.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <Input
            type="password"
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            autoFocus
            aria-label="Password"
          />
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!password}>
              Update server
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
