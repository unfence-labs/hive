import type { StepFn } from "../operations.js";
import type { EmitFn } from "../operations.js";
import { StepError } from "../operations.js";
import { detectTools } from "../detect.js";
import {
  installGhStep,
  installDockerStep,
  installClaudeStep,
  installCodexStep,
} from "./tools.js";
import { ghAuthStep } from "./auth-gh.js";
import { codexAuthStep } from "./auth-codex.js";
import { makeClaudeTokenWriter } from "../auth-flows.js";
import type { InstallerDeps } from "./command.js";

export interface SetupStepDef {
  title: string;
  fn: StepFn;
}

/** Report the current detection snapshot as log lines. */
function detectStep(): StepFn {
  return async (emit: EmitFn) => {
    await emit({ stream: "system", line: "Detecting installed tools" });
    const detected = await detectTools({ force: true });
    for (const [tool, info] of Object.entries(detected)) {
      const parts = [info.installed ? "installed" : "missing"];
      if (info.version) parts.push(`v${info.version}`);
      if (info.authenticated !== undefined) {
        parts.push(info.authenticated ? "authenticated" : "unauthenticated");
      }
      await emit({ stream: "stdout", line: `${tool}: ${parts.join(", ")}` });
    }
    return { detected };
  };
}

/**
 * Final verify: re-probe and confirm every tool the wizard is responsible for
 * resolves. Missing tools fail the step (so the wizard reports what to retry).
 */
function verifyStep(): StepFn {
  return async (emit: EmitFn) => {
    await emit({ stream: "system", line: "Verifying installation" });
    const detected = await detectTools({ force: true });
    const required = ["gh", "docker"] as const;
    const missing = required.filter((t) => detected[t]?.installed !== true);
    for (const tool of required) {
      const ok = detected[tool]?.installed === true;
      await emit({ stream: ok ? "stdout" : "stderr", line: `${tool}: ${ok ? "ok" : "missing"}` });
    }
    if (missing.length > 0) {
      throw new StepError(
        "UNKNOWN",
        `Verification failed: ${missing.join(", ")} not installed`,
        { hint: "Retry the install steps for the missing tools." },
      );
    }
    return { detected };
  };
}

/**
 * The runnable setup step registry (§6.3), replacing the earlier stubs. Each
 * value pairs a human title with the real step function.
 *
 * `depsOverride` (installer command deps) is injectable for tests; the API wires
 * it with production defaults.
 */
export function buildSetupSteps(opts: {
  installerDeps?: InstallerDeps;
} = {}): Record<string, SetupStepDef> {
  const deps = opts.installerDeps;
  return {
    detect: { title: "Detect tools", fn: detectStep() },
    install_gh: { title: "Install GitHub CLI", fn: installGhStep(deps) },
    auth_gh: { title: "Authenticate GitHub", fn: ghAuthStep() },
    install_codex: { title: "Install Codex", fn: installCodexStep(deps) },
    auth_codex: { title: "Authenticate Codex", fn: codexAuthStep() },
    install_claude: { title: "Install Claude Code", fn: installClaudeStep(deps) },
    install_docker: { title: "Install Docker (rootless)", fn: installDockerStep(deps) },
    verify: { title: "Verify installation", fn: verifyStep() },
  };
}

/** Production step registry with default (real) installer deps. */
export const SETUP_STEPS: Record<string, SetupStepDef> = buildSetupSteps();

/** Re-export so the API can build a Claude token writer over the same deps. */
export { makeClaudeTokenWriter };
