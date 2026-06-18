import { randomUUID } from "node:crypto";
import { StreamParser } from "../stream-parser.js";
import type { MessageOptions, SessionKind } from "../../types.js";
import type { AgentProvider, StreamAdapter } from "../providers/types.js";
import type { AgentRunner } from "./types.js";
import { CodexAppServerRunner } from "./codex-app-server-runner.js";
import { buildCodexAppServerArgs } from "../providers/codex-app-server.js";
import { ProcessAgentRunner } from "./process-agent-runner.js";

export interface CreateAgentRunnerInput {
  cwd: string;
  content: string;
  msgOptions?: MessageOptions;
  resolved?: { provider: AgentProvider; modelId: string };
  testCommand?: string;
  isFirstMessage: boolean;
  systemPrompt?: string;
  skipPermissions: boolean;
  /** Strip interactive/blocking tools — set for unattended agent runs. */
  disableInteractiveTools?: boolean;
  /** Enforce read-only execution — set for read-only agent runs. */
  readOnly?: boolean;
  browserEnv?: Record<string, string>;
  sessionKind: SessionKind;
  providerSessionId?: string;
  imagePaths?: string[];
  existingCodexAppServerRunner?: AgentRunner | null;
}

export interface CreatedAgentRunner {
  runner: AgentRunner;
  protocol: "process" | "codex_app_server";
  providerId: string | undefined;
  modelId: string | undefined;
  supportsBlockingTools: boolean;
  providerSessionId?: string;
  cachedCodexAppServerRunner?: AgentRunner;
  debug: {
    command: string;
    args: string[];
  };
  start(): void;
}

type CodexAppServerStartRunner = AgentRunner & {
  startTurn(turn: {
    cwd: string;
    content: string;
    imagePaths?: string[];
    model?: string;
    thinkingLevel?: MessageOptions["thinkingLevel"];
    systemPrompt?: string;
    threadId?: string;
    env?: Record<string, string>;
    readOnly?: boolean;
  }): void;
};

export function createAgentRunner(input: CreateAgentRunnerInput): CreatedAgentRunner {
  const { provider, modelId } = input.testCommand
    ? { provider: null as AgentProvider | null, modelId: "" }
    : input.resolved!;

  const useCodexAppServer = !input.testCommand && provider!.id === "codex";
  const supportsBlockingTools = provider?.capabilities.blockingTools ?? false;

  if (useCodexAppServer) {
    const enableGoals = provider!.capabilities.goals;
    const env = {
      ...(provider!.buildEnv?.({ ...input.msgOptions, model: modelId }) ?? {}),
      ...(input.browserEnv ?? {}),
    };
    const runner = (
      input.existingCodexAppServerRunner ?? new CodexAppServerRunner(undefined, { enableGoals })
    ) as CodexAppServerStartRunner;
    const model = provider!.models.find((m) => m.id === modelId);
    return {
      runner,
      protocol: "codex_app_server",
      providerId: provider!.id,
      modelId,
      supportsBlockingTools,
      cachedCodexAppServerRunner: runner,
      debug: {
        command: "codex",
        args: buildCodexAppServerArgs(enableGoals),
      },
      start: () => runner.startTurn({
        cwd: input.cwd,
        content: input.content,
        imagePaths: input.imagePaths,
        model: model?.cliValue ?? modelId,
        thinkingLevel: input.msgOptions?.thinkingLevel ?? "high",
        systemPrompt: input.systemPrompt,
        threadId: input.providerSessionId,
        env,
        readOnly: input.readOnly,
      }),
    };
  }

  const nextProviderSessionId = input.providerSessionId ?? randomUUID();
  let command: string;
  let args: string[];
  let env: Record<string, string> | undefined;
  let parser: StreamAdapter;

  if (input.testCommand) {
    command = input.testCommand;
    args = ["-c", `echo '{"type":"result","session_id":"test","duration_ms":0}'`];
    parser = new StreamParser();
  } else {
    // Only providers that ship CLI arg/stream support reach the process runner;
    // Codex is always routed to the app-server above.
    if (!provider!.buildArgs || !provider!.createStreamAdapter) {
      throw new Error(`Provider ${provider!.id} only supports the app-server runner`);
    }
    command = provider!.command;
    args = provider!.buildArgs(input.content, { ...input.msgOptions, model: modelId }, {
      isFirstMessage: input.isFirstMessage,
      sessionId: nextProviderSessionId,
      systemPrompt: input.systemPrompt,
      skipPermissions: input.skipPermissions,
      disableInteractiveTools: input.disableInteractiveTools,
      readOnly: input.readOnly,
    });
    env = {
      ...(provider!.buildEnv?.({ ...input.msgOptions, model: modelId }) ?? {}),
      ...(input.browserEnv ?? {}),
    };
    parser = provider!.createStreamAdapter();
  }

  const runner = new ProcessAgentRunner({
    command,
    args,
    cwd: input.cwd,
    env,
    parser,
    useWorkspaceEnv: !input.testCommand,
  });

  return {
    runner,
    protocol: "process",
    providerId: provider?.id,
    modelId,
    supportsBlockingTools,
    providerSessionId: nextProviderSessionId,
    debug: { command, args },
    start: () => runner.start(),
  };
}

export type AgentRunnerFactory = typeof createAgentRunner;
