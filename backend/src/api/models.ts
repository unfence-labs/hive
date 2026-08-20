import type { FastifyInstance } from "fastify";
import { getModelCatalog } from "../agents/providers/registry.js";
import {
  AUTH_GATED_PROVIDER_IDS,
  providerAuthentication,
  type ProviderAuthenticationReader,
} from "../services/setup/provider-authentication.js";
import { loadConfig } from "../state/config.js";

export interface ModelRoutesOptions {
  dataDir?: string;
  authentication?: ProviderAuthenticationReader;
}

export async function modelRoutes(
  app: FastifyInstance,
  options: ModelRoutesOptions = {},
) {
  const authentication = options.authentication ?? providerAuthentication;

  app.get("/api/models", async (_req, reply) => {
    // Load config first: it also refreshes the cached Kimi API key that
    // getModelCatalog uses to decide whether Kimi models are offered.
    const { defaultModelId } = await loadConfig(options.dataDir);
    const excludedProviderIds = new Set(
      AUTH_GATED_PROVIDER_IDS.filter(
        (providerId) => authentication.getState(providerId) === "unauthenticated",
      ),
    );
    const catalog = getModelCatalog({ excludedProviderIds });
    // Apply the user-configured default only while its model is still in the
    // catalog; otherwise keep the computed default.
    if (defaultModelId && catalog.models.some((m) => m.id === defaultModelId)) {
      catalog.defaultModelId = defaultModelId;
    }
    return reply.send(catalog);
  });
}
