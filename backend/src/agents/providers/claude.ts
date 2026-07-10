import { StreamParser } from "../stream-parser.js";
import {
  findModel,
  type AgentProvider,
  type ModelDefinition,
  type ProviderCapabilities,
  type ProviderMessageOptions,
  type ProviderSessionState,
  type StreamAdapter,
} from "./types.js";

const CLAUDE_MODELS: ModelDefinition[] = [
  // Fable 5 ships with a 1M context window by default, so its cliValue needs no
  // explicit `[1m]` opt-in (unlike Opus 4.8). Adaptive thinking is always on and
  // depth is controlled via --effort; it has no fast mode.
  { id: "fable-5", label: "Fable 5", cliValue: "claude-fable-5", isNew: true, contextWindow: 1_000_000 },
  { id: "opus-4-8", label: "Opus 4.8", cliValue: "claude-opus-4-8[1m]", aliases: ["opus-4-7"], isDefault: true, contextWindow: 1_000_000, supportsFastMode: true },
  { id: "sonnet-4-6", label: "Sonnet 4.6", cliValue: "claude-sonnet-4-6", contextWindow: 200_000 },
  { id: "haiku-4-5", label: "Haiku 4.5", cliValue: "claude-haiku-4-5", contextWindow: 200_000 },
];

// Tools that only work inside a persistent, idle Claude Code harness: they
// schedule a wakeup or stream a background process between turns. Hive runs a
// one-shot `claude --print` per turn, so the process exits when the turn ends —
// a scheduled wakeup is then orphaned (nothing fires it) and the model later
// reports its background work as crashed/missing on `--resume`. Suppress them
// for every Claude session so the model stays synchronous. Synchronous
// subagents (the Task/Agent tool the parent turn waits for) are unaffected.
// See the README backlog for what full support would require.
const HARNESS_SCHEDULING_TOOLS = ["ScheduleWakeup", "Monitor", "CronCreate", "CronList", "CronDelete"];

const CLAUDE_CAPABILITIES: ProviderCapabilities = {
  thinkingLevels: ["low", "medium", "high", "xhigh", "max"],
  planMode: true,
  blockingTools: true,
  completions: true,
  goals: false,
};

export class ClaudeProvider implements AgentProvider {
  readonly id = "claude";
  readonly command = "claude";
  readonly models = CLAUDE_MODELS;
  readonly capabilities = CLAUDE_CAPABILITIES;

  buildArgs(
    content: string,
    options: ProviderMessageOptions,
    session: ProviderSessionState,
  ): string[] {
    const model = findModel(this.models, options.model);
    // Fast mode is Opus-only; never emit it for models that don't support it,
    // even if the flag leaks through from a stale client selection. There is no
    // `--fast` flag in headless mode, so we override the `fastMode` setting for
    // this session via inline `--settings` JSON (merges over settings.json).
    const fastMode = !!options.fastMode && !!model?.supportsFastMode;
    // Always suppress the harness-only scheduling tools (see above). On top of
    // that, agent-run enforcement strips interactive tools (no human can answer
    // unattended), and for read-only agents blocks the edit tools while keeping
    // Bash so read-only audits can still grep/build/test. Interactive chat gets
    // only the scheduling base list, leaving the native plan-mode path untouched.
    const disallowedTools: string[] = [...HARNESS_SCHEDULING_TOOLS];
    if (session.disableInteractiveTools) {
      disallowedTools.push("AskUserQuestion", "ExitPlanMode");
    }
    if (session.readOnly) {
      disallowedTools.push("Edit", "Write", "NotebookEdit");
    }
    return [
      "--print",
      "--output-format", "stream-json",
      "--verbose",
      ...(model ? ["--model", model.cliValue] : []),
      ...(options.thinkingLevel ? ["--effort", options.thinkingLevel] : []),
      ...(fastMode ? ["--settings", JSON.stringify({ fastMode: true })] : []),
      ...(disallowedTools.length > 0 ? ["--disallowedTools", disallowedTools.join(" ")] : []),
      ...(options.planMode
        ? ["--permission-mode", "plan"]
        : session.skipPermissions ? ["--dangerously-skip-permissions"] : []),
      ...(session.isFirstMessage && session.systemPrompt
        ? ["--append-system-prompt", session.systemPrompt]
        : []),
      ...(session.isFirstMessage
        ? ["--session-id", session.sessionId]
        : ["--resume", session.sessionId]),
      "-p", content,
    ];
  }

  buildEnv(_options: ProviderMessageOptions): Record<string, string> {
    return {
      // Keep the Task/subagent system on: synchronous subagents (the parent turn
      // waits for the result) work fine in print mode and are used heavily.
      CLAUDE_CODE_ENABLE_TASKS: "true",
      // Disable harness-only scheduling that the one-shot print model can't honor:
      // cron/`/loop` firing, and background tasks (`run_in_background` plus the
      // auto-backgrounding of long subagents) that would die at process exit or be
      // lost on `--resume`. See HARNESS_SCHEDULING_TOOLS and the README backlog.
      CLAUDE_CODE_DISABLE_CRON: "1",
      CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
    };
  }

  createStreamAdapter(): StreamAdapter {
    return new StreamParser();
  }
}
