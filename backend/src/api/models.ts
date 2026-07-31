import type { FastifyInstance } from "fastify";
import { getModelCatalog } from "../agents/providers/registry.js";
import {
  SETUP_TOOLS,
  type SetupToolSpec,
} from "../services/setup/catalog.js";
import {
  defaultDetectDeps,
  detectToolAuthentication,
  type DetectDeps,
} from "../services/setup/detect.js";
import { loadConfig } from "../state/config.js";

export interface ModelRoutesOptions {
  dataDir?: string;
  detect?: DetectDeps;
}

export async function modelRoutes(
  app: FastifyInstance,
  options: ModelRoutesOptions = {},
) {
  const detect = options.detect ?? defaultDetectDeps();
  const providerTools = SETUP_TOOLS.filter(
    (tool): tool is SetupToolSpec & { authenticatedProviderId: string } =>
      tool.authenticatedProviderId !== undefined,
  );

  app.get("/api/models", async (_req, reply) => {
    // Load config first: it also refreshes the cached Kimi API key that
    // getModelCatalog uses to decide whether Kimi models are offered.
    const [{ defaultModelId }, providerAuthentication] = await Promise.all([
      loadConfig(options.dataDir),
      Promise.all(
        providerTools.map(async (tool) => ({
          providerId: tool.authenticatedProviderId,
          authenticated: await detectToolAuthentication(tool.id, detect),
        })),
      ),
    ]);
    const excludedProviderIds = new Set(
      providerAuthentication
        .filter(({ authenticated }) => !authenticated)
        .map(({ providerId }) => providerId),
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
