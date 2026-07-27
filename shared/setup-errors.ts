/**
 * Shared setup error taxonomy.
 *
 * The provisioning script emits one of these codes on the `run_end` record of
 * a failed run. `test/provision/contract.sh` collects every code the shell
 * sources can emit (`die <CODE>`, `STEP_ERR_CODE`) and asserts that set
 * matches this list exactly.
 */

export const SETUP_ERROR_CODES = [
  "UNSUPPORTED_OS",
  "UNSUPPORTED_ARCH",
  "NOT_ROOT",
  "CONCURRENT_RUN",
  "EXISTING_INSTALL",
  "PORT_IN_USE",
  "DIRECTORY_UNUSABLE",
  "INSUFFICIENT_DISK_SPACE",
  "SSH_KEY_INVALID",
  "FIREWALL_RULE_FAILED",
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
  DIRECTORY_UNUSABLE:
    "Hive cannot write to the install or data directory you chose, because its parent does not exist or is not writable. Create the parent, or pick a different --install-dir / --data-dir, then Retry.",
  INSUFFICIENT_DISK_SPACE:
    "The filesystem holding the install or data directory does not have enough free space. Free some space, or point --install-dir / --data-dir at a larger filesystem, then Retry.",
  SSH_KEY_INVALID:
    "The public key supplied for the hive service account is not a valid OpenSSH public key. Check the key you pasted, then Retry.",
  FIREWALL_RULE_FAILED:
    "The server's firewall is active but the rule opening Hive's port could not be added. If you restricted the rule to a network interface, check that interface still exists on the server. Otherwise add the rule by hand, or Retry.",
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

/**
 * Transport-level errors owned by the desktop app's SSH sidecar
 * (`frontend/src-tauri/src/provision.rs`), which carries the same list in
 * `SSH_ERROR_CODES`. They cover what goes wrong before or around a run rather
 * than inside it, so they are deliberately separate from the codes above: those
 * come off the script's `run_end` record and must stay in lockstep with
 * `scripts/provision/lib.sh`. A sidecar failure that has no transport cause
 * reuses `CONCURRENT_RUN` or `UNKNOWN` from the list above.
 */
export const SSH_ERROR_CODES = [
  "SSH_INVALID_INPUT",
  "SSH_UNREACHABLE",
  "SSH_AUTH_FAILED",
  "SSH_HOST_KEY_UNKNOWN",
  "SSH_HOST_KEY_CHANGED",
  "SSH_ESCALATION_FAILED",
  "SSH_PASSWORD_REQUIRED",
] as const;

export type SshErrorCode = (typeof SSH_ERROR_CODES)[number];

export function isSshErrorCode(value: string): value is SshErrorCode {
  return (SSH_ERROR_CODES as readonly string[]).includes(value);
}

export const SSH_ERROR_HINTS: Record<SshErrorCode, string> = {
  SSH_INVALID_INPUT:
    "One of the values you entered is not a usable host, user, path or key. Correct it, then Retry.",
  SSH_UNREACHABLE:
    "The server did not answer on SSH. Check the address and that port 22 is reachable from here, then Retry.",
  SSH_AUTH_FAILED:
    "The server refused the SSH key. Check that the key you picked is authorized for that account — and, if it is passphrase-protected, that it is loaded in your ssh-agent — then Retry.",
  SSH_HOST_KEY_UNKNOWN:
    "This server has not been approved yet. Review its fingerprint and approve it, then Retry.",
  SSH_HOST_KEY_CHANGED:
    "This server now presents a different host key than the one you approved. Hive will not re-trust it automatically. If you rebuilt the server this is expected — remove it from Hive's approved servers and approve the new fingerprint. Otherwise stop: the connection may be intercepted.",
  SSH_ESCALATION_FAILED:
    "The account could not gain root on the server. Check the password you entered, and that the account is allowed to use sudo, then Retry.",
  SSH_PASSWORD_REQUIRED:
    "This account needs a password to gain root on the server. Enter it, then Retry.",
};
