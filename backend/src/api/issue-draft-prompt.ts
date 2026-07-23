import type { FastifyInstance } from "fastify";
import {
  loadIssueDraftPromptData,
  saveIssueDraftPrompt,
  resetIssueDraftPrompt,
} from "../state/issue-draft-prompt.js";
import { getDataDir } from "../state/state.js";
import { DEFAULT_ISSUE_DRAFT_PROMPT } from "../agents/issue-draft-prompt.js";
import { registerPromptFileRoutes } from "./prompt-file-routes.js";

interface IssueDraftPromptRoutesOptions {
  dataDir?: string;
}

export async function issueDraftPromptRoutes(
  app: FastifyInstance,
  opts: IssueDraftPromptRoutesOptions = {},
): Promise<void> {
  const dataDir = opts.dataDir ?? getDataDir();

  registerPromptFileRoutes(app, {
    basePath: "/api/prompts/issue-draft",
    defaultContent: DEFAULT_ISSUE_DRAFT_PROMPT,
    load: () => loadIssueDraftPromptData(dataDir),
    save: (content) => saveIssueDraftPrompt(content, dataDir),
    reset: () => resetIssueDraftPrompt(dataDir),
  });
}
