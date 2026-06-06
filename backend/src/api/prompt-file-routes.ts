import type { FastifyInstance } from "fastify";
import { withTemplatesLock } from "../state/prompt-templates.js";
import type { PromptFileData } from "../state/prompt-file.js";

export interface PromptFileRouteConfig {
  /** REST base path, e.g. `/api/prompts/base`. */
  basePath: string;
  /** The default content used to compute `isDefault` on PUT responses. */
  defaultContent: string;
  load: () => Promise<PromptFileData>;
  save: (content: string) => Promise<void>;
  reset: () => Promise<void>;
}

/**
 * Register GET/PUT/DELETE routes for a single editable prompt file.
 * Shared by the base prompt and the Brain prompt so validation, locking, and
 * response shapes never drift between them.
 */
export function registerPromptFileRoutes(
  app: FastifyInstance,
  config: PromptFileRouteConfig,
): void {
  const { basePath, defaultContent, load, save, reset } = config;

  app.get(basePath, async () => load());

  app.put<{ Body: { content: string } }>(basePath, async (req, reply) => {
    const { content } = req.body ?? {};
    if (typeof content !== "string" || !content.trim()) {
      return reply.status(400).send({ error: "Content is required" });
    }
    await withTemplatesLock(async () => {
      await save(content);
    });
    return {
      content,
      isDefault: content === defaultContent,
      defaultContent,
    } satisfies PromptFileData;
  });

  app.delete(basePath, async (_req, reply) => {
    await withTemplatesLock(async () => {
      await reset();
    });
    return reply.status(204).send();
  });
}
