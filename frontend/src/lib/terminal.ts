import { isDesktopShell as isTauri } from "@/lib/is-desktop";

export interface TerminalApp {
  id: string;
  name: string;
}

/**
 * Detect installed terminal applications via Tauri command.
 * Returns an empty array in browser mode.
 */
export async function detectTerminals(): Promise<TerminalApp[]> {
  if (!isTauri()) return [];
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<TerminalApp[]>("detect_terminals");
  } catch (error) {
    console.warn("Failed to detect terminals:", error);
    return [];
  }
}

/**
 * Build an SSH command that connects to the remote host and cd's into the workspace.
 *
 * Output: ssh user@host -t "cd '/escaped/path' && exec \$SHELL -l"
 *
 * The path is single-quoted so the remote shell won't expand special chars.
 * $SHELL is escaped as \$SHELL so the local shell passes it literally to ssh,
 * and the remote shell expands it to the user's login shell.
 */
export function buildSshCommand(sshHost: string, remotePath: string): string {
  const escapedPath = remotePath.replace(/'/g, "'\\''");
  return `ssh ${sshHost} -t "cd '${escapedPath}' && exec \\$SHELL -l"`;
}

/**
 * Open a terminal application with an SSH session to the workspace.
 * Only works in Tauri mode.
 */
export async function openTerminalSsh(
  terminalId: string,
  sshHost: string,
  remotePath: string,
): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  const command = buildSshCommand(sshHost, remotePath);
  await invoke("open_terminal_ssh", { terminalId, command });
}
