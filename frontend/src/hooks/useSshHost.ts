import { useConnection } from "@/hooks/useConnection";

/**
 * Derive the SSH host used for VS Code Remote SSH + terminal-SSH actions.
 *
 * Resolution order for the base host: Tailscale IP → backend server hostname →
 * the current window hostname. When an SSH user is configured it is prefixed as
 * `user@host`. `sshBaseHost` is exposed separately so callers can tell "no host
 * configured at all" apart from "host but no user".
 */
export function useSshHost(): { sshHost: string; sshBaseHost: string } {
  const { connection } = useConnection();
  const sshUser = connection?.sshUser ?? "";
  const fallbackWindowHost = typeof window !== "undefined" ? window.location.hostname : "";
  const sshBaseHost = connection?.host || fallbackWindowHost;
  const sshHost = sshUser && sshBaseHost ? `${sshUser}@${sshBaseHost}` : sshBaseHost;

  return { sshHost, sshBaseHost };
}
