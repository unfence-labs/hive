import type { DetectableTool } from "@hive/shared/setup-types";
import { detectAvailableProviders } from "../../../agents/providers/registry.js";
import { detectTools } from "../detect.js";
import { StepError, type StepFn } from "../operations.js";
import {
  defaultInstallerDeps,
  type CommandResult,
  type InstallerDeps,
} from "./command.js";

interface InstallerSpec {
  tool: Exclude<DetectableTool, "gh">;
  title: string;
  command: string;
  env?: Record<string, string>;
}

const NETWORK_FAILURE =
  /could not resolve|getaddrinfo|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|network is unreachable|temporary failure in name resolution/i;

function commandFailure(message: string, result: CommandResult): StepError {
  const output = `${result.stderr}\n${result.stdout}`;
  const detail = (result.stderr || result.stdout)
    .trim()
    .split("\n")
    .slice(-4)
    .join("\n");
  const code = NETWORK_FAILURE.test(output) ? "NETWORK" : "UNKNOWN";
  return new StepError(code, message, { detail: detail || undefined });
}

function makeInstallerStep(
  spec: InstallerSpec,
  depsOverride?: InstallerDeps,
): StepFn {
  return async () => {
    const current = await detectTools();
    if (current[spec.tool].installed) return;

    const deps = depsOverride ?? defaultInstallerDeps();
    const result = await deps.run(spec.command, { env: spec.env });
    if (result.exitCode !== 0) {
      throw commandFailure(`${spec.title} install failed`, result);
    }

    const verified = await detectTools();
    if (!verified[spec.tool].installed) {
      throw new StepError(
        "UNKNOWN",
        `${spec.title} did not resolve after install`,
        { detail: "The install command completed but the executable is not on PATH." },
      );
    }
    await detectAvailableProviders();
  };
}

export function installClaudeStep(depsOverride?: InstallerDeps): StepFn {
  return makeInstallerStep(
    {
      tool: "claude",
      title: "Claude Code",
      command: "curl -fsSL https://claude.ai/install.sh | bash",
      env: { DISABLE_AUTOUPDATER: "1" },
    },
    depsOverride,
  );
}

export function installCodexStep(depsOverride?: InstallerDeps): StepFn {
  return makeInstallerStep(
    {
      tool: "codex",
      title: "Codex",
      command: 'npm install -g --prefix "$HOME/.local" @openai/codex',
    },
    depsOverride,
  );
}
