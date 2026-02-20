import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

interface Dependency {
  name: string;
  command: string;
  versionArgs: string[];
  required: boolean;
  /** e.g. [2, 17] — only major.minor checked */
  minVersion?: [number, number];
  parseVersion?: (stdout: string) => string | null;
}

const DEPENDENCIES: Dependency[] = [
  {
    name: "git",
    command: "git",
    versionArgs: ["--version"],
    required: true,
    minVersion: [2, 17], // worktree remove --force requires 2.17+
    parseVersion: (out) => out.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null,
  },
  {
    name: "claude",
    command: "claude",
    versionArgs: ["--version"],
    required: true,
  },
  {
    name: "gh",
    command: "gh",
    versionArgs: ["--version"],
    required: true,
    parseVersion: (out) => out.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null,
  },
  {
    name: "codex",
    command: "codex",
    versionArgs: ["--version"],
    required: false,
  },
];

export function meetsMinVersion(version: string, min: [number, number]): boolean {
  const parts = version.split(".").map(Number);
  const [major, minor] = [parts[0] ?? 0, parts[1] ?? 0];
  return major > min[0] || (major === min[0] && minor >= min[1]);
}

export async function preflight(): Promise<void> {
  const errors: string[] = [];

  for (const dep of DEPENDENCIES) {
    try {
      const { stdout } = await execFile(dep.command, dep.versionArgs);
      const version = dep.parseVersion?.(stdout);

      if (version && dep.minVersion && !meetsMinVersion(version, dep.minVersion)) {
        errors.push(
          `${dep.name} ${version} is too old (need >= ${dep.minVersion.join(".")})`,
        );
      }
    } catch {
      if (dep.required) {
        errors.push(`'${dep.name}' not found — install it before starting the server`);
      } else {
        console.warn(`[preflight] optional: '${dep.name}' not found — related features disabled`);
      }
    }
  }

  if (errors.length) {
    for (const e of errors) console.error(`[preflight] ${e}`);
    process.exit(1);
  }
}
