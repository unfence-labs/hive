import { useState } from "react";
import { KeyRound } from "lucide-react";
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
import { useConnection } from "@/hooks/useConnection";
import {
  useDesktopUpdateState,
  respondToUpdate,
  dismissUpdateInput,
} from "@/hooks/useDesktopUpdate";
import type { SshKey } from "@/lib/provision-client";

export function UpdateDialogs() {
  const update = useDesktopUpdateState();
  const { connection } = useConnection();
  if (update.phase !== "input") return null;
  const close = (open: boolean) => {
    if (!open) dismissUpdateInput();
  };
  if (update.kind === "agents")
    return (
      <AgentsRunningDialog
        open
        onOpenChange={close}
        busyWorkspaces={update.busyWorkspaces}
        onConfirm={() => respondToUpdate({ confirmAgents: true })}
      />
    );
  if (update.kind === "key")
    return (
      <SshKeyPickerDialog
        open
        onOpenChange={close}
        keys={update.keys ?? []}
        onPick={(key) => respondToUpdate({ keyPath: key.path })}
      />
    );
  return (
    <PasswordPrompt adminUser={connection?.adminUser} onOpenChange={close} />
  );
}

function PasswordPrompt({
  adminUser,
  onOpenChange,
}: {
  adminUser?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const [password, setPassword] = useState("");
  return (
    <EscalationPasswordDialog
      open
      onOpenChange={onOpenChange}
      adminUser={adminUser}
      password={password}
      onPasswordChange={setPassword}
      onSubmit={() => {
        respondToUpdate({ password });
        setPassword("");
      }}
    />
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
  busyWorkspaces?: number;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {busyWorkspaces === undefined
              ? "Restart the server?"
              : "Agents are running"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {busyWorkspaces === undefined ? (
              "Updating restarts the server and stops any running agents."
            ) : (
              <>
                {busyWorkspaces} workspace
                {busyWorkspaces === 1 ? " has" : "s have"} agents running.
                Updating restarts the server and stops them.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            Update anyway
          </AlertDialogAction>
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
            The key used to install this server. It is remembered for future
            updates.
          </DialogDescription>
        </DialogHeader>
        {keys.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No usable SSH key found in ~/.ssh.
          </p>
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
                  <span className="text-xs text-muted-foreground">
                    {key.keyType}
                  </span>
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
            {adminUser ?? "root"} needs a password to escalate on the server. It
            is used for this run only and never stored.
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
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
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
