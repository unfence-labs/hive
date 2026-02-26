import type { FastifyInstance } from "fastify";
import { loadBasePromptData, saveBasePrompt, resetBasePrompt } from "../state/base-prompt.js";
import { withTemplatesLock } from "../state/prompt-templates.js";
import { getDataDir } from "../state/state.js";
import { DEFAULT_BASE_PROMPT } from "../agents/system-prompt.js";

interface BasePromptRoutesOptions {
  dataDir?: string;
}

export async function basePromptRoutes(
  app: FastifyInstance,
  opts: BasePromptRoutesOptions = {},
): Promise<void> {
  const dataDir = opts.dataDir ?? getDataDir();

  app.get("/api/prompts/base", async () => {
    return loadBasePromptData(dataDir);
  });

  app.put<{ Body: { content: string } }>("/api/prompts/base", async (req, reply) => {
    const { content } = req.body ?? {};
    if (typeof content !== "string" || !content.trim()) {
      return reply.status(400).send({ error: "Content is required" });
    }
    await withTemplatesLock(async () => {
      await saveBasePrompt(content, dataDir);
    });
    return { content, isDefault: content === DEFAULT_BASE_PROMPT, defaultContent: DEFAULT_BASE_PROMPT };
  });

  app.delete("/api/prompts/base", async (_req, reply) => {
    await withTemplatesLock(async () => {
      await resetBasePrompt(dataDir);
    });
    return reply.status(204).send();
  });
}
