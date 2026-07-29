import { useConnection } from "@/hooks/useConnection";

/**
 * Derive the SSH host used for VS Code Remote SSH + terminal-SSH actions.
 *
 * The host comes from the connection record, falling back to the current window
 * hostname when no server is configured. The user is the record's `sshUser` —
 * the unprivileged service account — never `adminUser`: an editor session
 * connecting as root takes ownership of every file it saves, after which the
 * agent can no longer write them. `sshBaseHost` is exposed separately so callers
 * can tell "no host configured at all" apart from "host but no user".
 */
export function useSshHost(): { sshHost: string; sshBaseHost: string } {
  const { connection } = useConnection();
  const sshUser = connection?.sshUser ?? "";
  const fallbackWindowHost = typeof window !== "undefined" ? window.location.hostname : "";
  const sshBaseHost = connection?.host || fallbackWindowHost;
  const sshHost = sshUser && sshBaseHost ? `${sshUser}@${sshBaseHost}` : sshBaseHost;

  return { sshHost, sshBaseHost };
}
