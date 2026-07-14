import type { FastifyInstance } from "fastify";
import { getModelCatalog } from "../agents/providers/registry.js";
import { loadConfig } from "../state/config.js";

export async function modelRoutes(app: FastifyInstance) {
  app.get("/api/models", async (_req, reply) => {
    const catalog = getModelCatalog();
    const { defaultModelId } = await loadConfig();
    // Apply the user-configured default only while its model is still in the
    // catalog (provider CLI installed); otherwise keep the computed default.
    if (defaultModelId && catalog.models.some((m) => m.id === defaultModelId)) {
      catalog.defaultModelId = defaultModelId;
    }
    return reply.send(catalog);
  });
}
