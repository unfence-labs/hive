import { useMemo } from "react";
import { useTailscaleConfig } from "@/hooks/useTailscaleConfig";
import { useServerUrl } from "@/hooks/useServerUrl";

/**
 * Derive the SSH host used for VS Code Remote SSH + terminal-SSH actions.
 *
 * Resolution order for the base host: Tailscale IP → backend server hostname →
 * the current window hostname. When an SSH user is configured it is prefixed as
 * `user@host`. `sshBaseHost` is exposed separately so callers can tell "no host
 * configured at all" apart from "host but no user".
 */
export function useSshHost(): { sshHost: string; sshBaseHost: string } {
  const { ip: tailscaleIp, sshUser } = useTailscaleConfig();
  const { serverUrl } = useServerUrl();

  const backendHost = useMemo(() => {
    if (!serverUrl) return "";
    try {
      const normalized = serverUrl.includes("://") ? serverUrl : `http://${serverUrl}`;
      return new URL(normalized).hostname;
    } catch {
      return "";
    }
  }, [serverUrl]);

  const fallbackWindowHost = typeof window !== "undefined" ? window.location.hostname : "";
  const sshBaseHost = tailscaleIp || backendHost || fallbackWindowHost;
  const sshHost = sshUser && sshBaseHost ? `${sshUser}@${sshBaseHost}` : sshBaseHost;

  return { sshHost, sshBaseHost };
}
