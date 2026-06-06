import { randomUUID } from "node:crypto";
import { StreamParser } from "../stream-parser.js";
import { providerSupportsAppServer, providerSupportsAppServerGoals } from "../providers/registry.js";
import type { MessageOptions } from "../../types.js";
import type { AgentProvider } from "../providers/types.js";
import type { AgentRunner } from "./types.js";
import { CodexAppServerRunner } from "./codex-app-server-runner.js";
import { ProcessAgentRunner } from "./process-agent-runner.js";

type SessionKind = "chat" | "automation" | "brain";

export interface CreateAgentRunnerInput {
  cwd: string;
  content: string;
  msgOptions?: MessageOptions;
  resolved?: { provider: AgentProvider; modelId: string };
  testCommand?: string;
  isFirstMessage: boolean;
  systemPrompt?: string;
  skipPermissions: boolean;
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
  }): void;
};

export function createAgentRunner(input: CreateAgentRunnerInput): CreatedAgentRunner {
  const { provider, modelId } = input.testCommand
    ? { provider: null as AgentProvider | null, modelId: "" }
    : input.resolved!;

  const useCodexAppServer =
    !input.testCommand &&
    provider!.id === "codex" &&
    input.sessionKind === "chat" &&
    providerSupportsAppServer(provider!.id);
  const supportsBlockingTools = provider?.capabilities.blockingTools ?? false;

  if (useCodexAppServer) {
    const enableGoals = providerSupportsAppServerGoals(provider!.id);
    const env = {
      ...(provider!.buildEnv({ ...input.msgOptions, model: modelId }) ?? {}),
      ...(input.browserEnv ?? {}),
    };
    const runner = (
      input.existingCodexAppServerRunner ?? new CodexAppServerRunner(undefined, { enableGoals })
    ) as CodexAppServerStartRunner;
    const model = provider!.models.find((m) => m.id === modelId);
    const appServerArgs = [
      "app-server",
      ...(enableGoals ? ["--enable", "goals"] : []),
      "--listen",
      "stdio://",
    ];
    return {
      runner,
      protocol: "codex_app_server",
      providerId: provider!.id,
      modelId,
      supportsBlockingTools,
      cachedCodexAppServerRunner: runner,
      debug: {
        command: "codex",
        args: appServerArgs,
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
      }),
    };
  }

  const nextProviderSessionId = input.providerSessionId ?? randomUUID();
  let command: string;
  let args: string[];
  let env: Record<string, string> | undefined;
  let stdinContent: string | undefined;

  if (input.testCommand) {
    command = input.testCommand;
    args = ["-c", `echo '{"type":"result","session_id":"test","duration_ms":0}'`];
  } else {
    command = provider!.command;
    let cliContent = input.content;
    if (input.isFirstMessage && input.systemPrompt && provider!.id !== "claude") {
      cliContent = `<context>\n${input.systemPrompt}\n</context>\n\n${input.content}`;
    }

    args = provider!.buildArgs(cliContent, { ...input.msgOptions, model: modelId }, {
      isFirstMessage: input.isFirstMessage,
      sessionId: nextProviderSessionId,
      systemPrompt: input.systemPrompt,
      skipPermissions: input.skipPermissions,
    });
    if (provider!.id === "codex") {
      stdinContent = cliContent;
    }
    env = {
      ...(provider!.buildEnv({ ...input.msgOptions, model: modelId }) ?? {}),
      ...(input.browserEnv ?? {}),
    };
  }

  const runner = new ProcessAgentRunner({
    command,
    args,
    cwd: input.cwd,
    env,
    stdinContent,
    parser: input.testCommand ? new StreamParser() : provider!.createStreamAdapter(),
    providerId: provider?.id,
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
