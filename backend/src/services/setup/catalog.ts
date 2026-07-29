import { homedir } from "node:os";
import { join } from "node:path";
import type { SetupToolId } from "@hive/shared/setup-types";
import { NPM_PACKAGES, PROVIDER_LABELS } from "../../agents/providers/registry.js";

export interface SetupToolSpec {
  id: SetupToolId;
  label: string;
  /** Executable name probed on PATH. */
  command: string;
  /** npm package backing install and update; empty when Hive does not manage it. */
  npmPackage: string;
}

/**
 * The tools Hive drives. Labels and packages for the agent CLIs come from the
 * provider registry, which owns them. `gh` is listed so its state is reported,
 * but carries no package: the provisioning script installs it from a
 * checksum-pinned tarball, and Hive will not offer an install path it cannot
 * verify.
 */
export const SETUP_TOOLS: readonly SetupToolSpec[] = [
  {
    id: "claude",
    label: PROVIDER_LABELS.claude,
    command: "claude",
    npmPackage: NPM_PACKAGES.claude,
  },
  {
    id: "codex",
    label: PROVIDER_LABELS.codex,
    command: "codex",
    npmPackage: NPM_PACKAGES.codex,
  },
  { id: "gh", label: "GitHub CLI", command: "gh", npmPackage: "" },
];

export function findToolSpec(id: SetupToolId): SetupToolSpec {
  // Every id in SetupToolId has a catalog entry, so the lookup cannot miss.
  return SETUP_TOOLS.find((tool) => tool.id === id)!;
}

export function isManaged(spec: SetupToolSpec): boolean {
  return spec.npmPackage !== "";
}

/**
 * Where installs land. The service account's own prefix, never system-wide:
 * the server is assumed to be running other things, and a global `npm -g`
 * would swap out binaries those things depend on. This mirrors
 * `HIVE_TOOLS_DIR` in `scripts/provision/steps.sh`, whose `bin` is already the
 * first entry on the service unit's PATH — so a tool installed here is the one
 * the agent runners resolve.
 */
export function toolsPrefix(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.HIVE_TOOLS_DIR?.trim();
  return configured || join(env.HOME?.trim() || homedir(), ".local");
}

/**
 * The install/update command. Both kinds resolve to the same thing on purpose:
 * npm installing `@latest` over an existing tree is exactly what an update is,
 * and pretending otherwise would mean maintaining two code paths that must not
 * diverge.
 */
export function installCommand(
  spec: SetupToolSpec,
  prefix: string,
): { command: string; args: string[] } {
  return {
    command: "npm",
    args: [
      "install",
      "-g",
      "--prefix",
      prefix,
      "--no-audit",
      "--no-fund",
      `${spec.npmPackage}@latest`,
    ],
  };
}
