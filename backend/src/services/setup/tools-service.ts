import type {
  ToolOperationKind,
  ToolStatus,
} from "@hive/shared/setup-types";
import { detectAvailableProviders } from "../../agents/providers/registry.js";
import {
  installCommand,
  isManaged,
  SETUP_TOOLS,
  toolsPrefix,
  type SetupToolSpec,
} from "./catalog.js";
import {
  classifyFailure,
  outputExcerpt,
  runCommand,
  type RunCommand,
} from "./command.js";
import { defaultDetectDeps, detectTool, type DetectDeps } from "./detect.js";
import { providerAuthentication } from "./provider-authentication.js";
import { fetchLatestNpmVersion, isNewerVersion } from "./npm-registry.js";
import { ToolOperationError, type OperationRunner } from "./operations.js";

export interface ToolsServiceDeps {
  detect: DetectDeps;
  run: RunCommand;
  fetchLatestVersion: (packageName: string) => Promise<string | null>;
  prefix: string;
  /** Called after a tool lands so the model catalog stops hiding it. */
  onToolsChanged: () => Promise<void>;
}

export function defaultToolsServiceDeps(): ToolsServiceDeps {
  return {
    detect: defaultDetectDeps(),
    run: runCommand,
    fetchLatestVersion: fetchLatestNpmVersion,
    prefix: toolsPrefix(),
    onToolsChanged: async () => {
      await detectAvailableProviders();
      await providerAuthentication.refresh({ force: true });
    },
  };
}

/**
 * Detection and the registry lookup for every tool, in parallel. One tool
 * being slow or absent must not stall the others: a panel that renders nothing
 * because `gh` is missing is worse than one that renders `gh` as missing.
 */
export async function getToolsStatus(deps: ToolsServiceDeps): Promise<ToolStatus[]> {
  return Promise.all(
    SETUP_TOOLS.map(async (spec): Promise<ToolStatus> => {
      const [detection, latestVersion] = await Promise.all([
        detectTool(spec, deps.detect),
        isManaged(spec) ? deps.fetchLatestVersion(spec.npmPackage) : Promise.resolve(null),
      ]);
      const updateAvailable =
        detection.installed && detection.version != null && latestVersion != null
          ? isNewerVersion(detection.version, latestVersion)
          : false;

      return {
        id: spec.id,
        label: spec.label,
        installed: detection.installed,
        version: detection.version,
        latestVersion,
        updateAvailable,
        authenticated: detection.authenticated,
        managed: isManaged(spec),
      };
    }),
  );
}

/**
 * The work behind one install or update.
 *
 * An install re-detects first and returns early when the tool is already
 * there, which is what makes retrying after an interrupted run cheap and safe.
 * An update always runs: "already installed" is precisely the state it exists
 * to change.
 */
export function makeToolOperationRunner(
  spec: SetupToolSpec,
  kind: ToolOperationKind,
  deps: ToolsServiceDeps,
): OperationRunner {
  return async ({ setPhase }) => {
    setPhase("detecting");
    const before = await detectTool(spec, deps.detect);
    if (kind === "install" && before.installed) return;

    setPhase("running");
    const { command, args } = installCommand(spec, deps.prefix);
    const result = await deps.run(command, args);
    if (result.exitCode !== 0) {
      throw new ToolOperationError(
        classifyFailure(result),
        `${spec.label} ${kind} failed (exit ${result.exitCode}).`,
        { outputExcerpt: outputExcerpt(result) },
      );
    }

    setPhase("verifying");
    const after = await detectTool(spec, deps.detect);
    if (!after.installed) {
      throw new ToolOperationError(
        "not_on_path",
        `${spec.label} reported a successful ${kind} but is still not executable.`,
        { outputExcerpt: outputExcerpt(result) },
      );
    }

    await deps.onToolsChanged();
  };
}
