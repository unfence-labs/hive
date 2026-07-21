import type { DetectableTool } from "@hive/shared/setup-types";
import { StepError } from "../operations.js";
import type { EmitFn } from "../operations.js";
import { detectTools } from "../detect.js";
import { detectAvailableProviders } from "../../../agents/providers/registry.js";
import {
  type InstallerDeps,
  type CommandResult,
  defaultInstallerDeps,
  runHelper,
} from "./command.js";

/**
 * Non-interactive tool installers. Each installer follows the same
 * guard -> install -> verify shape:
 *
 *   1. guard: if `detect` already reports the tool installed, skip.
 *   2. install: user-space installers just run a command; root-requiring ones
 *      go through a privileged helper. Off a provisioned server (no helpers
 *      dir), root steps degrade to a clearly-logged no-op success so the wizard
 *      stays demoable on any box.
 *   3. verify: re-probe and confirm the tool now resolves.
 */

type Runner = (
  emit: EmitFn,
  deps: InstallerDeps,
) => Promise<Record<string, unknown> | void>;

interface InstallerSpec {
  /** Tool key used for the detect-based guard + verify. */
  tool: DetectableTool;
  title: string;
  run: Runner;
}

async function isInstalled(tool: DetectableTool): Promise<boolean> {
  const detected = await detectTools({ force: true });
  return detected[tool]?.installed === true;
}

/** Fail with the given code, surfacing the command's stderr tail as the hint. */
function commandFailure(
  code: StepError["code"],
  message: string,
  result: CommandResult,
): StepError {
  const tail = (result.stderr || result.stdout).trim().split("\n").slice(-4).join("\n");
  return new StepError(code, message, {
    exitCode: result.exitCode,
    hint: tail || undefined,
  });
}

/**
 * Build a step function from an installer spec. `depsOverride` lets tests inject
 * a fake `run`/helper detector so nothing shells out.
 */
export function makeInstallerStep(
  spec: InstallerSpec,
  depsOverride?: InstallerDeps,
) {
  return async (emit: EmitFn): Promise<Record<string, unknown> | void> => {
    const deps = depsOverride ?? defaultInstallerDeps();

    await emit({ stream: "system", line: `${spec.title}: checking existing install` });
    if (await isInstalled(spec.tool)) {
      await emit({ stream: "stdout", line: `${spec.tool} already installed; skipping` });
      return { skipped: true, reason: "already-installed" };
    }

    const data = await spec.run(emit, deps);

    await emit({ stream: "system", line: `${spec.title}: verifying` });
    if (!(await isInstalled(spec.tool))) {
      // Off-server degrade path returns { degraded: true } and never claims the
      // tool is present, so a failed verify there is expected — pass through.
      if (data && (data as Record<string, unknown>).degraded === true) {
        await emit({
          stream: "system",
          line: `${spec.tool} not verifiable off-server (degraded no-op); continuing`,
        });
        return data;
      }
      throw new StepError(
        "UNKNOWN",
        `${spec.tool} did not resolve after install`,
        { hint: `Open the ${spec.title} log for details.` },
      );
    }
    await emit({ stream: "stdout", line: `${spec.tool} verified` });
    // The provider catalog is probed once at boot — before guided setup
    // installs the agent CLIs. Re-probe so models appear without a restart.
    await detectAvailableProviders();
    return data;
  };
}

/**
 * Run a root-requiring helper, degrading to a logged no-op success off-server.
 * Returns `{ degraded: true }` when helpers are unavailable so the verify step
 * knows not to hard-fail.
 */
async function installViaHelper(
  emit: EmitFn,
  deps: InstallerDeps,
  helper: string,
  humanName: string,
  errorCode: StepError["code"],
  note?: string,
): Promise<Record<string, unknown> | void> {
  if (!(await deps.helpersAvailable())) {
    await emit({
      stream: "system",
      line:
        `${humanName}: privileged helpers unavailable (not a provisioned server); ` +
        `skipping root install as a no-op. On a real server this runs ` +
        `sudo ${deps.helpersDir}/${helper}.sh.`,
    });
    return { degraded: true, reason: "no-helpers" };
  }
  await emit({ stream: "system", line: `${humanName}: running privileged helper ${helper}.sh` });
  const result = await runHelper(deps, helper);
  if (result.stdout.trim()) await emit({ stream: "stdout", line: result.stdout.trim() });
  if (result.stderr.trim()) await emit({ stream: "stderr", line: result.stderr.trim() });
  if (result.exitCode !== 0) {
    throw commandFailure(errorCode, `${humanName} helper failed`, result);
  }
  if (note) await emit({ stream: "system", line: note });
  return undefined;
}

/** Run a user-space install command, failing with NETWORK on non-zero exit. */
async function installUserSpace(
  emit: EmitFn,
  deps: InstallerDeps,
  command: string,
  humanName: string,
  env?: Record<string, string>,
): Promise<void> {
  await emit({ stream: "system", line: `${humanName}: installing (user-space)` });
  const result = await deps.run(command, { env });
  if (result.stdout.trim()) await emit({ stream: "stdout", line: result.stdout.trim() });
  if (result.stderr.trim()) await emit({ stream: "stderr", line: result.stderr.trim() });
  if (result.exitCode !== 0) {
    throw commandFailure("NETWORK", `${humanName} install failed`, result);
  }
}

// --- Installer specs ---

/** GitHub CLI: official apt repo, root-required -> helper. */
export function installGhStep(depsOverride?: InstallerDeps) {
  return makeInstallerStep(
    {
      tool: "gh",
      title: "Install GitHub CLI",
      run: (emit, deps) =>
        installViaHelper(emit, deps, "install-gh", "GitHub CLI", "APT_FAILURE"),
    },
    depsOverride,
  );
}

/** Claude Code: official native installer to ~/.local/bin (user-space). */
export function installClaudeStep(depsOverride?: InstallerDeps) {
  return makeInstallerStep(
    {
      tool: "claude",
      title: "Install Claude Code",
      run: (emit, deps) =>
        installUserSpace(
          emit,
          deps,
          "curl -fsSL https://claude.ai/install.sh | bash",
          "Claude Code",
          { DISABLE_AUTOUPDATER: "1" },
        ),
    },
    depsOverride,
  );
}

/** Codex CLI: npm install into the user prefix (the service user cannot write
 * the system-wide npm prefix, and ~/.local/bin is already on the service PATH). */
export function installCodexStep(depsOverride?: InstallerDeps) {
  return makeInstallerStep(
    {
      tool: "codex",
      title: "Install Codex",
      run: (emit, deps) =>
        installUserSpace(
          emit,
          deps,
          'npm install -g --prefix "$HOME/.local" @openai/codex',
          "Codex",
        ),
    },
    depsOverride,
  );
}
