import { ChevronDownIcon, TerminalIcon } from "lucide-react";
import { VscodeIcon, Iterm2Icon } from "@/components/icons/software-icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useTerminalApps } from "@/hooks/useTerminalApps";
import { useSshHost } from "@/hooks/useSshHost";
import { openExternal, buildVscodeRemoteUri } from "@/lib/open-external";
import { openTerminalSsh } from "@/lib/terminal";

interface OpenTargetDropdownProps {
  /** Absolute path to open (workspace worktree path or Brain repo path). */
  path: string | undefined;
  /** Tooltip shown when the path is unavailable. */
  pathUnavailableReason?: string;
}

const DEFAULT_PATH_UNAVAILABLE_REASON = "Path unavailable.";

/**
 * "Open" menu offering VS Code Remote SSH + terminal-SSH actions for a local
 * path on the backend host. Renders a dropdown when terminal apps are detected
 * (Tauri desktop), otherwise a single tooltip-wrapped VS Code button. Shared by
 * the Workspace and Brain headers — it internalizes its own SSH-host derivation
 * so neither page needs to duplicate that logic.
 */
export function OpenTargetDropdown({
  path,
  pathUnavailableReason = DEFAULT_PATH_UNAVAILABLE_REASON,
}: OpenTargetDropdownProps) {
  const terminalApps = useTerminalApps();
  const { sshHost, sshBaseHost } = useSshHost();

  const vscodeUri = path && sshHost ? buildVscodeRemoteUri(sshHost, path) : null;
  const vscodeDisabledReason = !sshBaseHost
    ? "Configure SSH host in Settings first"
    : !path
      ? pathUnavailableReason
      : null;
  const canOpenVscode = vscodeUri !== null;
  const canSsh = !!sshHost && !!path;

  if (terminalApps.length > 0) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="xs" className="ml-2 text-muted-foreground hover:text-foreground">
            <TerminalIcon className="size-3.5" />
            Open
            <ChevronDownIcon className="ml-0.5 size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[140px]">
          <DropdownMenuItem
            disabled={!canOpenVscode}
            onSelect={() => { if (vscodeUri) void openExternal(vscodeUri); }}
          >
            <VscodeIcon className="size-3.5" />
            VS Code
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {terminalApps.map((t) => {
            const Icon = t.id === "iterm2" ? Iterm2Icon : TerminalIcon;
            return (
              <DropdownMenuItem
                key={t.id}
                disabled={!canSsh}
                onSelect={() => {
                  if (canSsh && path) {
                    void openTerminalSsh(t.id, sshHost, path);
                  }
                }}
              >
                <Icon className="size-3.5" />
                {t.name} (SSH)
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button
              variant="ghost"
              size="xs"
              className="ml-2 text-muted-foreground hover:text-foreground"
              onClick={() => { if (vscodeUri) void openExternal(vscodeUri); }}
              disabled={!canOpenVscode}
            >
              <VscodeIcon className="mr-1.5 size-3.5" />
              VS Code
            </Button>
          </span>
        </TooltipTrigger>
        {vscodeDisabledReason && (
          <TooltipContent>{vscodeDisabledReason}</TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );
}
