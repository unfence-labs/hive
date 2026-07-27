/**
 * Shared setup error taxonomy.
 *
 * `scripts/provision/lib.sh` carries the same list in `SETUP_ERROR_CODES` and
 * emits one of these codes on the `run_end` record of a failed provisioning
 * run. `test/provision/contract.sh` asserts the two stay in sync, including
 * that every `die <CODE>` in the shell sources names a code declared here.
 */

export const SETUP_ERROR_CODES = [
  "UNSUPPORTED_OS",
  "UNSUPPORTED_ARCH",
  "NOT_ROOT",
  "CONCURRENT_RUN",
  "EXISTING_INSTALL",
  "PORT_IN_USE",
  "APT_FAILURE",
  "NODE_INSTALL_FAILED",
  "AGENT_CLI_INSTALL_FAILED",
  "RELEASE_DOWNLOAD_FAILED",
  "CHECKSUM_MISMATCH",
  "TOKEN_GENERATION_FAILED",
  "SERVICE_START_FAILED",
  "HEALTH_TIMEOUT",
  "AUTH_NOT_ENFORCED",
  "UNKNOWN",
] as const;

export type SetupErrorCode = (typeof SETUP_ERROR_CODES)[number];

export function isSetupErrorCode(value: string): value is SetupErrorCode {
  return (SETUP_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * User-facing hint per error code. Each hint says what to DO next, not just
 * what happened, so a client can render it verbatim next to a Retry button.
 */
export const SETUP_ERROR_HINTS: Record<SetupErrorCode, string> = {
  UNSUPPORTED_OS:
    "Hive needs Ubuntu 22.04/24.04 or Debian 12/13 with systemd. Recreate the server with one of those images, then start over.",
  UNSUPPORTED_ARCH:
    "Hive runs on x86-64 or arm64 servers only. Recreate the server with a supported architecture, then start over.",
  NOT_ROOT:
    "The installer must run as root. Re-run it as root, or through sudo, then Retry.",
  CONCURRENT_RUN:
    "Another installer run is already in progress on this server. Wait for it to finish, then Retry.",
  EXISTING_INSTALL:
    "Something other than Hive already owns /opt/hive on this server. Remove it, or pick a different server, then Retry.",
  PORT_IN_USE:
    "The port Hive wants is already taken by another service. Free it, or re-run the installer with a different --port, then Retry.",
  APT_FAILURE:
    "A system package failed to install. Press Retry. If it fails again, the diagnostic below names the failing package.",
  NODE_INSTALL_FAILED:
    "Hive's private Node.js runtime could not be installed. Check that the server can reach nodejs.org, then press Retry.",
  AGENT_CLI_INSTALL_FAILED:
    "The agent command-line tools could not be installed. Check that the server can reach the npm registry and github.com, then press Retry.",
  RELEASE_DOWNLOAD_FAILED:
    "The Hive backend could not be fetched onto the server. Check that the server has internet access, then press Retry.",
  CHECKSUM_MISMATCH:
    "A download arrived corrupted. Press Retry. If it keeps happening, your server's network may be tampering with downloads — report it.",
  TOKEN_GENERATION_FAILED:
    "The server could not generate an access token, so Hive was not started (starting it would have left it unprotected). Press Retry.",
  SERVICE_START_FAILED:
    "Hive installed but its service failed to start. The diagnostic below shows why. Press Retry after fixing the reported issue.",
  HEALTH_TIMEOUT:
    "Hive's service started but never answered on its port. Press Retry once; if it persists, inspect the reported service diagnostic.",
  AUTH_NOT_ENFORCED:
    "Hive started but accepted an unauthenticated request, so the installer stopped the service. This is a bug — report it with the diagnostic below.",
  UNKNOWN:
    "Something unexpected went wrong. Review the diagnostic below, then retry the installer.",
};
