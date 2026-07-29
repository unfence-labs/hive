import type { FastifyInstance } from "fastify";
import { loadConfig, updateConfig } from "../state/config.js";
import { getModelCatalog } from "../agents/providers/registry.js";
import { rebuildNotifier } from "../agents/agent-manager.js";
import { TelegramChannel } from "../notifications/telegram.js";

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/settings/defaults", async () => {
    const config = await loadConfig();
    return { defaultModelId: config.defaultModelId ?? null };
  });

  app.put<{
    Body: { defaultModelId?: string | null };
  }>("/api/settings/defaults", async (req, reply) => {
    const { defaultModelId } = req.body ?? {};
    if (defaultModelId !== null && typeof defaultModelId !== "string") {
      return reply.status(400).send({ error: "Invalid payload" });
    }
    if (defaultModelId && !getModelCatalog().models.some((m) => m.id === defaultModelId)) {
      return reply.status(400).send({ error: "Unknown model id" });
    }
    const config = await updateConfig((c) => {
      if (!defaultModelId) {
        delete c.defaultModelId;
      } else {
        c.defaultModelId = defaultModelId;
      }
    });
    return { defaultModelId: config.defaultModelId ?? null };
  });

  app.get("/api/settings/kimi", async () => {
    const config = await loadConfig();
    return { apiKey: config.kimi.apiKey };
  });

  app.put<{
    Body: { apiKey?: string };
  }>("/api/settings/kimi", async (req, reply) => {
    const { apiKey } = req.body ?? {};
    if (typeof apiKey !== "string") {
      return reply.status(400).send({ error: "Invalid payload" });
    }
    const config = await updateConfig((c) => {
      c.kimi.apiKey = apiKey.trim();
    });
    return { apiKey: config.kimi.apiKey };
  });

  app.get("/api/settings/notifications", async () => {
    const config = await loadConfig();
    return config.notifications;
  });

  app.put<{
    Body: {
      telegram?: { enabled: boolean; botToken: string; chatId: string };
    };
  }>("/api/settings/notifications", async (req, reply) => {
    const { telegram } = req.body;
    const hasTelegram = telegram && typeof telegram.enabled === "boolean";
    if (!hasTelegram) {
      return reply.status(400).send({ error: "Invalid payload" });
    }
    const config = await updateConfig((c) => {
      c.notifications.telegram = {
        enabled: telegram.enabled,
        botToken: telegram.botToken?.trim() ?? "",
        chatId: telegram.chatId?.trim() ?? "",
      };
    });
    rebuildNotifier(config);
    return { ok: true };
  });

  app.post<{
    Body: { botToken: string; chatId: string };
  }>("/api/settings/notifications/test", async (req, reply) => {
    const { botToken, chatId } = req.body;
    if (!botToken?.trim() || !chatId?.trim()) {
      return reply.status(400).send({ ok: false, error: "Bot token and chat ID are required" });
    }
    const result = await TelegramChannel.sendTest(botToken, chatId);
    return result;
  });
}
