import type { FastifyInstance } from "fastify";
import { loadBrainPromptData, saveBrainPrompt, resetBrainPrompt } from "../state/brain-prompt.js";
import { getDataDir } from "../state/state.js";
import { BRAIN_BASE_PROMPT } from "../agents/system-prompt.js";
import { registerPromptFileRoutes } from "./prompt-file-routes.js";

interface BrainPromptRoutesOptions {
  dataDir?: string;
}

export async function brainPromptRoutes(
  app: FastifyInstance,
  opts: BrainPromptRoutesOptions = {},
): Promise<void> {
  const dataDir = opts.dataDir ?? getDataDir();

  registerPromptFileRoutes(app, {
    basePath: "/api/prompts/brain",
    defaultContent: BRAIN_BASE_PROMPT,
    load: () => loadBrainPromptData(dataDir),
    save: (content) => saveBrainPrompt(content, dataDir),
    reset: () => resetBrainPrompt(dataDir),
  });
}
