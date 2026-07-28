import type { PreflightReport } from "@/lib/provision-client";

/**
 * Reading the preflight report the way the connect screen presents it.
 *
 * The whole point of running preflight before the install is that anything the
 * operator can still correct is reported while the form is still editable. So
 * every blocking finding that a form field can fix names that field, and the
 * ones no field can fix say so instead of pointing at nothing.
 */

/** Human title per check id, so a finding never renders as a bare identifier. */
export const CHECK_TITLES: Record<string, string> = {
  os: "Operating system",
  systemd: "systemd",
  arch: "Architecture",
  privilege: "Root access",
  existing_install: "Existing install",
  port: "Backend port",
  install_dir: "Install directory",
  data_dir: "Data directory",
  firewall: "Firewall",
  ssh_key: "Service account key",
};

/**
 * Which field on which screen corrects a failing check. A check absent from
 * this map cannot be fixed from the installer — the operator has to change
 * something on the server itself.
 */
export const CHECK_FIELDS: Record<string, string> = {
  port: "the port on the Network step",
  install_dir: "the install directory on the Network step",
  data_dir: "the data directory on the Network step",
  existing_install: "the install directory on the Network step",
  ssh_key: "the SSH key on the SSH key step",
};

export function checkTitle(check: string): string {
  return CHECK_TITLES[check] ?? check;
}

/** What to correct, or undefined when nothing on these screens would help. */
export function correctableField(check: string): string | undefined {
  return CHECK_FIELDS[check];
}

/**
 * Whether the install will have to be given a password to reach root. Read off
 * the script's own `privilege` finding and nothing else: a password offered to
 * a sudo that never reads it becomes the first line of the streamed script.
 */
export function needsEscalationPassword(report: PreflightReport): boolean {
  return report.privilege.mode === "sudoPassword";
}

/** A report only clears the way when the script itself says it does. */
export function canProceed(report: PreflightReport): boolean {
  return report.ok && report.blockers.length === 0;
}
