import { vi } from "vitest";
import type {
  HostIdentity,
  PreflightCheck,
  PreflightReport,
  PrivilegeMode,
  ProvisionClient,
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
  errorCode?: string,
): PreflightCheck {
  return { check: name, status, detail, ...(errorCode ? { errorCode } : {}) };
}

export const OK_CHECKS: PreflightCheck[] = [
  check("os", "ok", "ubuntu 24.04 is supported"),
  check("port", "ok", "port 9420 is free"),
  check("firewall", "ok", "no active firewall; the installer will not enable one"),
];

export function report(overrides: Partial<PreflightReport> = {}): PreflightReport {
  const privilegeMode: PrivilegeMode = overrides.privilege?.mode ?? "root";
  return {
    ok: true,
    blockers: [],
    checks: OK_CHECKS,
    privilege: {
      root: privilegeMode === "root",
      sudoNoPassword: privilegeMode !== "sudoPassword",
      mode: privilegeMode,
    },
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
      check("port", "fail", "port 9420 is already in use by another service", "PORT_IN_USE"),
    ],
  });
}

export interface MockProvisionClient extends ProvisionClient {
  listKeys: ReturnType<typeof vi.fn>;
  testConnection: ReturnType<typeof vi.fn>;
  trustHost: ReturnType<typeof vi.fn>;
  preflight: ReturnType<typeof vi.fn>;
}

export function createMockProvisionClient(
  overrides: Partial<{
    keys: SshKey[];
    identity: HostIdentity;
    preflight: PreflightReport;
  }> = {},
): MockProvisionClient {
  return {
    listKeys: vi.fn().mockResolvedValue(overrides.keys ?? [USABLE_KEY, LOCKED_KEY]),
    testConnection: vi.fn().mockResolvedValue(overrides.identity ?? UNTRUSTED_HOST),
    trustHost: vi.fn().mockResolvedValue(undefined),
    preflight: vi.fn().mockResolvedValue(overrides.preflight ?? report()),
  };
}
