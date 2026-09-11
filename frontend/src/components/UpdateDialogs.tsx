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

/**
 * Everything an update run has to ask for. The coordinator owns the question,
 * so exactly one of these is open at a time and dismissing any of them cancels
 * the run.
 */
export function UpdateDialogs() {
  const update = useDesktopUpdateState();
  if (update.phase !== "input") return null;
  const close = (open: boolean) => {
    if (!open) dismissUpdateInput();
  };
  if (update.kind === "agents")
    return (
      <AgentsRunningDialog
        onOpenChange={close}
        busyWorkspaces={update.busyWorkspaces}
      />
    );
  if (update.kind === "key")
    return <SshKeyPickerDialog onOpenChange={close} keys={update.keys ?? []} />;
  return <EscalationPasswordDialog onOpenChange={close} />;
}

function AgentsRunningDialog({
  onOpenChange,
  busyWorkspaces,
}: {
  onOpenChange: (open: boolean) => void;
  /** Unknown when no app window ever observed the workspaces. */
  busyWorkspaces?: number;
}) {
  return (
    <AlertDialog open onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {busyWorkspaces === undefined
              ? "Restart the server?"
              : "Agents are running"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {busyWorkspaces === undefined
              ? "Updating restarts the server and stops any running agents."
              : `${busyWorkspaces} workspace${busyWorkspaces === 1 ? " has" : "s have"} agents running. Updating restarts the server and stops them.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => respondToUpdate({ confirmAgents: true })}
          >
            Update anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function SshKeyPickerDialog({
  onOpenChange,
  keys,
}: {
  onOpenChange: (open: boolean) => void;
  keys: SshKey[];
}) {
  return (
    <Dialog open onOpenChange={onOpenChange}>
      {/* A picker, so it takes the palette surface its rows hover against. */}
      <DialogContent className="bg-popover text-popover-foreground sm:max-w-md">
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
          <div className="space-y-0.5">
            {keys.map((key) => (
              <button
                key={key.path}
                type="button"
                onClick={() => respondToUpdate({ keyPath: key.path })}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{key.label}</span>
                {key.keyType && (
                  <span className="shrink-0 text-xs text-muted-foreground">
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
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void;
}) {
  const { connection } = useConnection();
  const [password, setPassword] = useState("");
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Escalation password</DialogTitle>
          <DialogDescription>
            {connection?.adminUser ?? "root"} needs a password to escalate on
            the server. It is used for this run only and never stored.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            respondToUpdate({ password });
            setPassword("");
          }}
        >
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
            aria-label="Password"
          />
          <DialogFooter>
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
