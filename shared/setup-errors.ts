// Shared setup/provision error taxonomy. Mirrored in scripts/provision/lib.sh
// (SETUP_ERROR_CODES). A contract test asserts the two lists are identical.

export const SETUP_ERROR_CODES = [
  "UNSUPPORTED_OS",
  "UNSUPPORTED_ARCH",
  "SERVER_NOT_PRISTINE",
  "EXISTING_INSTALL",
  "APT_LOCK_TIMEOUT",
  "APT_FAILURE",
  "NETWORK",
  "CHECKSUM_MISMATCH",
  "TS_AUTHKEY_INVALID",
  "TS_DAEMON_DOWN",
  "UFW_FAILURE",
  "RELEASE_DOWNLOAD_FAILED",
  "SERVICE_START_FAILED",
  "HEALTH_TIMEOUT",
  "SSH_AUTH_FAILED",
  "SSH_HOST_KEY_CHANGED",
  "SSH_UNREACHABLE",
  "SSH_NO_ROOT",
  "CLAUDE_PASTEBACK_BROKEN",
  "DEVICE_CODE_EXPIRED",
  "CODEX_DEVICE_AUTH_DISABLED",
  "GH_POLL_STUCK",
  "INTERRUPTED",
  "CONCURRENT_RUN",
  "UNKNOWN",
] as const;

export type SetupErrorCode = (typeof SETUP_ERROR_CODES)[number];

/** User-facing hint per error code (i18n-ready keys map to these defaults).
 * Each hint must tell the user what to DO next, not just what happened. */
export const SETUP_ERROR_HINTS: Record<SetupErrorCode, string> = {
  UNSUPPORTED_OS:
    "Hive needs Ubuntu 22.04/24.04 or Debian 12. Recreate the server with one of those images, then start over.",
  UNSUPPORTED_ARCH:
    "Hive runs on x86-64 or arm64 servers only. Recreate the server with a supported architecture, then start over.",
  SERVER_NOT_PRISTINE:
    "This server already runs other services. Use a fresh, empty server dedicated to Hive, then start over with its IP.",
  EXISTING_INSTALL:
    "Hive is already installed on this server. To use it, set its IP and token in Settings > Connection. To reinstall from scratch, remove /opt/hive on the server first, then Retry.",
  APT_LOCK_TIMEOUT:
    "The server's package manager is busy — usually automatic updates right after first boot. Wait a minute, then press Retry.",
  APT_FAILURE:
    "A system package failed to install. Press Retry (completed steps are skipped). If it fails again, the log below shows the failing package.",
  NETWORK:
    "The server itself has no internet access. Check its network/DNS in your provider's console, then press Retry.",
  CHECKSUM_MISMATCH:
    "A download arrived corrupted. Press Retry. If it keeps happening, your server's network may be tampering with downloads — report it.",
  TS_AUTHKEY_INVALID:
    "Tailscale rejected the auth key — expired, revoked, already used, or truncated. Create a new auth key in the Tailscale admin console, go Back to paste it, then continue.",
  TS_DAEMON_DOWN:
    "Tailscale installed but its service did not come up. Press Retry; if it persists, reboot the server and Retry again.",
  UFW_FAILURE:
    "The firewall could not be configured. Press Retry; the log below shows the failing rule.",
  RELEASE_DOWNLOAD_FAILED:
    "The Hive backend could not be fetched onto the server. Check the server has internet access, then press Retry. (Developing locally? Run 'make release-tarball' first, then Retry.)",
  SERVICE_START_FAILED:
    "Hive installed but its service failed to start. The log below shows why. Press Retry after fixing; if you're stuck, report it with the log.",
  HEALTH_TIMEOUT:
    "Hive's service started but never answered on its port. Press Retry once; if it persists, the log below shows the service output.",
  SSH_AUTH_FAILED:
    "The server refused this SSH key. Make sure the key you picked is authorized on the server (its .pub in ~/.ssh/authorized_keys of the SSH user), or go Back to pick another key.",
  SSH_HOST_KEY_CHANGED:
    "The server's SSH identity changed since last time. If you rebuilt the server, Start over to trust the new identity. If you didn't, stop — someone may be intercepting the connection.",
  SSH_UNREACHABLE:
    "Could not reach the server on SSH port 22. Check the IP is right, the server is running, and its firewall allows SSH, then press Retry.",
  SSH_NO_ROOT:
    "This SSH user can't run commands as root. Use root@ip instead, or give the user passwordless sudo on the server, then Retry.",
  CLAUDE_PASTEBACK_BROKEN:
    "Claude sign-in did not return a token. Open a terminal, run 'claude setup-token', copy the sk-ant-oat01-… token it prints, and paste it here.",
  DEVICE_CODE_EXPIRED:
    "The sign-in code expired before it was used. A fresh code is shown — enter it on the provider's page within a few minutes.",
  CODEX_DEVICE_AUTH_DISABLED:
    "Your ChatGPT workspace has device-code login disabled. Enable it in ChatGPT settings (Security), then press Retry.",
  GH_POLL_STUCK:
    "GitHub sign-in stalled. Press Retry to get a fresh code and enter it on github.com/login/device.",
  INTERRUPTED:
    "The install was interrupted — connection drop or app closed. Press Retry: completed steps are skipped and the install continues where it left off.",
  CONCURRENT_RUN:
    "This action is already running — possibly from a previous attempt. Wait a moment for it to finish, then retry.",
  UNKNOWN:
    "Something unexpected went wrong — the log below has the details. Retry is safe: completed steps are skipped. If it keeps failing, report it with the log.",
};
