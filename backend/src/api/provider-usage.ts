import type { FastifyInstance } from "fastify";
import {
  getProviderUsageSnapshot,
  type ProviderUsageResponse,
} from "../services/provider-usage.js";

export async function providerUsageRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/provider-usage", async (): Promise<ProviderUsageResponse> => {
    return getProviderUsageSnapshot();
  });
}
