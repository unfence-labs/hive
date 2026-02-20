import type { FastifyInstance } from "fastify";
import { getModelCatalog } from "../agents/providers/registry.js";

export async function modelRoutes(app: FastifyInstance) {
  app.get("/api/models", async (_req, reply) => {
    return reply.send(getModelCatalog());
  });
}
