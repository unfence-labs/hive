import type { StepFn } from "../operations.js";
import {
  installClaudeStep,
  installCodexStep,
} from "./tools.js";
import { ghAuthStep } from "./auth-gh.js";
import { codexAuthStep } from "./auth-codex.js";
import type { InstallerDeps } from "./command.js";

export interface SetupStepDef {
  title: string;
  fn: StepFn;
}

/**
 * The runnable setup step registry. Each value pairs a human title with the
 * real step function.
 *
 * `depsOverride` (installer command deps) is injectable for tests; the API wires
 * it with production defaults.
 */
export function buildSetupSteps(opts: {
  installerDeps?: InstallerDeps;
} = {}): Record<string, SetupStepDef> {
  const deps = opts.installerDeps;
  return {
    auth_gh: { title: "Authenticate GitHub", fn: ghAuthStep() },
    install_codex: { title: "Install Codex", fn: installCodexStep(deps) },
    auth_codex: { title: "Authenticate Codex", fn: codexAuthStep() },
    install_claude: { title: "Install Claude Code", fn: installClaudeStep(deps) },
  };
}

/** Production step registry with default (real) installer deps. */
export const SETUP_STEPS: Record<string, SetupStepDef> = buildSetupSteps();
