import type { FastifyInstance } from "fastify";
import { loadBasePromptData, saveBasePrompt, resetBasePrompt } from "../state/base-prompt.js";
import { getDataDir } from "../state/state.js";
import { DEFAULT_BASE_PROMPT } from "../agents/system-prompt.js";
import { registerPromptFileRoutes } from "./prompt-file-routes.js";

interface BasePromptRoutesOptions {
  dataDir?: string;
}

export async function basePromptRoutes(
  app: FastifyInstance,
  opts: BasePromptRoutesOptions = {},
): Promise<void> {
  const dataDir = opts.dataDir ?? getDataDir();

  registerPromptFileRoutes(app, {
    basePath: "/api/prompts/base",
    defaultContent: DEFAULT_BASE_PROMPT,
    load: () => loadBasePromptData(dataDir),
    save: (content) => saveBasePrompt(content, dataDir),
    reset: () => resetBasePrompt(dataDir),
  });
}
