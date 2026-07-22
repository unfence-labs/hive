import type { FastifyInstance } from "fastify";
import { getModelCatalog } from "../agents/providers/registry.js";
import { loadConfig } from "../state/config.js";

export async function modelRoutes(app: FastifyInstance) {
  app.get("/api/models", async (_req, reply) => {
    // Load config first: it also refreshes the cached Kimi API key that
    // getModelCatalog uses to decide whether Kimi models are offered.
    const { defaultModelId } = await loadConfig();
    const catalog = getModelCatalog();
    // Apply the user-configured default only while its model is still in the
    // catalog (provider CLI installed); otherwise keep the computed default.
    if (defaultModelId && catalog.models.some((m) => m.id === defaultModelId)) {
      catalog.defaultModelId = defaultModelId;
    }
    return reply.send(catalog);
  });
}
