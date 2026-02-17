import type { FastifyInstance } from "fastify";
import { loadConfig, saveConfig } from "../state/config.js";
import { rebuildNotifier } from "../agents/agent-manager.js";
import { TelegramChannel } from "../notifications/telegram.js";

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/settings/notifications", async () => {
    const config = await loadConfig();
    return config.notifications;
  });

  app.put<{
    Body: {
      telegram: { enabled: boolean; botToken: string; chatId: string };
    };
  }>("/api/settings/notifications", async (req, reply) => {
    const { telegram } = req.body;
    if (!telegram || typeof telegram.enabled !== "boolean") {
      return reply.status(400).send({ error: "Invalid payload" });
    }
    const config = await loadConfig();
    config.notifications.telegram = {
      enabled: telegram.enabled,
      botToken: telegram.botToken?.trim() ?? "",
      chatId: telegram.chatId?.trim() ?? "",
    };
    await saveConfig(config);
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
