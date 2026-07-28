import { vi } from "vitest";
import type {
  HostIdentity,
  InstallRequest,
  PreflightCheck,
  PreflightReport,
  PrivilegeMode,
  ProvisionClient,
  ProvisionRecord,
  SshKey,
} from "@/lib/provision-client";

export const USABLE_KEY: SshKey = {
  path: "/home/lenny/.ssh/id_ed25519",
  label: "id_ed25519",
  keyType: "ed25519",
  encrypted: false,
  agentLoaded: false,
  usable: true,
  publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI",
};

export const LOCKED_KEY: SshKey = {
  path: "/home/lenny/.ssh/id_rsa",
  label: "id_rsa",
  keyType: "rsa",
  encrypted: true,
  agentLoaded: false,
  usable: false,
};

export const UNTRUSTED_HOST: HostIdentity = {
  hostKey: "203.0.113.10 ssh-ed25519 AAAAC3Nz",
  fingerprint: "SHA256:qA1b2C3d4E5f6G7h8I9j0K",
  keyType: "ed25519",
  trusted: false,
};

function check(
  name: string,
  status: PreflightCheck["status"],
  detail: string,
): PreflightCheck {
  return { check: name, status, detail };
}

/** A check carrying the `data` object the script emits alongside its prose. */
function checkWithData(
  name: string,
  status: PreflightCheck["status"],
  detail: string,
  data: Record<string, unknown>,
): PreflightCheck {
  return { check: name, status, detail, data };
}

export const OK_CHECKS: PreflightCheck[] = [
  check("os", "ok", "ubuntu 24.04 is supported"),
  check("port", "ok", "port 9420 is free"),
  checkWithData("firewall", "ok", "no active firewall; the installer will not enable one", {
    backend: "ufw",
    active: false,
    ruleToApply: null,
  }),
];

/** A server whose ufw is already on and will be configured automatically. */
export function activeFirewallReport(): PreflightReport {
  return report({
    checks: [
      ...OK_CHECKS.filter((entry) => entry.check !== "firewall"),
      checkWithData(
        "firewall",
        "ok",
        "ufw is active; the installer will open TCP port 9420 automatically and change nothing else",
        { backend: "ufw", active: true, ruleToApply: "ufw allow 9420/tcp" },
      ),
    ],
  });
}

/** An active firewall Hive cannot configure without guessing its policy. */
export function foreignFirewallReport(): PreflightReport {
  return report({
    ok: false,
    blockers: ["firewall"],
    checks: [
      ...OK_CHECKS.filter((entry) => entry.check !== "firewall"),
      checkWithData(
        "firewall",
        "fail",
        "nftables is active, and Hive cannot configure it automatically",
        { backend: "nftables", active: true, ruleToApply: null },
      ),
    ],
  });
}

export function report(overrides: Partial<PreflightReport> = {}): PreflightReport {
  const privilegeMode: PrivilegeMode = overrides.privilege?.mode ?? "root";
  return {
    ok: true,
    blockers: [],
    checks: OK_CHECKS,
    privilege: { mode: privilegeMode },
    ...overrides,
  };
}

/** A report blocked by a busy port — the canonical correctable finding. */
export function blockedReport(): PreflightReport {
  return report({
    ok: false,
    blockers: ["port"],
    checks: [
      ...OK_CHECKS.filter((entry) => entry.check !== "port"),
      check("port", "fail", "port 9420 is already in use by another service"),
    ],
  });
}

// ── install stream ───────────────────────────────────────────────────────────

/** A representative slice of `scripts/provision/main.sh`'s STEPS. */
export const PLANNED_STEPS = ["probe_os", "create_user", "generate_token", "health_check"];

export const ACCESS_TOKEN = "b".repeat(64);

export function runStart(resume = false): ProvisionRecord {
  return {
    seq: 1,
    event: "run_start",
    resume,
    stepsPlanned: PLANNED_STEPS,
  };
}

/** The records a clean run emits, up to and including its terminal one. */
export function successRecords(resume = false): ProvisionRecord[] {
  return [
    runStart(resume),
    { seq: 2, step: "probe_os", status: "start", title: "Check the server" },
    { seq: 3, step: "probe_os", status: "log", line: "ubuntu 24.04 x86_64" },
    { seq: 4, step: "probe_os", status: "ok" },
    {
      seq: 5,
      step: "create_user",
      // `skipdata_create_user`: a skipped step still names the account.
      status: resume ? "skip" : "ok",
      data: { user: "hive" },
    },
    { seq: 6, step: "generate_token", status: "start", title: "Generate the access token" },
    {
      seq: 7,
      step: "generate_token",
      status: "ok",
      data: { accessToken: ACCESS_TOKEN },
    },
    { seq: 8, step: "health_check", status: "start", title: "Wait for Hive to become healthy" },
    { seq: 9, step: "health_check", status: "ok" },
    { seq: 10, event: "run_end", status: "ok" },
  ];
}

/** A run that dies inside a step, the way `die` reports it. */
export function failureRecords(): ProvisionRecord[] {
  return [
    runStart(),
    { seq: 2, step: "probe_os", status: "start", title: "Check the server" },
    { seq: 3, step: "probe_os", status: "ok" },
    { seq: 4, step: "create_user", status: "start", title: "Create the hive service account" },
    { seq: 5, step: "create_user", status: "log", line: "useradd: cannot open /etc/passwd" },
    {
      seq: 6,
      step: "create_user",
      status: "error",
      errorCode: "DIRECTORY_UNUSABLE",
      detail: "/home/hive/.hive is not writable",
    },
    {
      seq: 7,
      event: "run_end",
      status: "error",
      errorCode: "DIRECTORY_UNUSABLE",
      detail: "/home/hive/.hive is not writable",
    },
  ];
}

/** One in-flight call to `install`, driven by the test. */
export interface MockInstall {
  request: InstallRequest;
  /** Push records into the run, as the sidecar's channel would. */
  emit(...records: ProvisionRecord[]): void;
  /** Resolve the install promise. */
  finish(): void;
  /** Reject it, as a sidecar command that never reached the script would. */
  fail(error: unknown): void;
}

export interface MockProvisionClient extends ProvisionClient {
  listKeys: ReturnType<typeof vi.fn>;
  testConnection: ReturnType<typeof vi.fn>;
  trustHost: ReturnType<typeof vi.fn>;
  preflight: ReturnType<typeof vi.fn>;
  install: ReturnType<typeof vi.fn>;
  /** Every install started so far, oldest first. */
  installs: MockInstall[];
}

export function createMockProvisionClient(
  overrides: Partial<{
    keys: SshKey[];
    identity: HostIdentity;
    preflight: PreflightReport;
  }> = {},
): MockProvisionClient {
  const installs: MockInstall[] = [];
  const install = vi.fn(
    (request: InstallRequest, onRecord: (record: ProvisionRecord) => void) =>
      new Promise<void>((resolve, reject) => {
        installs.push({
          request,
          emit: (...records) => records.forEach(onRecord),
          finish: resolve,
          fail: reject,
        });
      }),
  );

  return {
    listKeys: vi.fn().mockResolvedValue(overrides.keys ?? [USABLE_KEY, LOCKED_KEY]),
    testConnection: vi.fn().mockResolvedValue(overrides.identity ?? UNTRUSTED_HOST),
    trustHost: vi.fn().mockResolvedValue(undefined),
    preflight: vi.fn().mockResolvedValue(overrides.preflight ?? report()),
    install,
    installs,
  };
}
