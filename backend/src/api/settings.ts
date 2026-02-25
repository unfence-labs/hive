import type { FastifyInstance } from "fastify";
import { loadConfig, saveConfig } from "../state/config.js";
import { rebuildNotifier, updateLiveApnsToken } from "../agents/agent-manager.js";
import { TelegramChannel } from "../notifications/telegram.js";
import { ApnsChannel } from "../notifications/apns.js";

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/settings/notifications", async () => {
    const config = await loadConfig();
    return config.notifications;
  });

  app.put<{
    Body: {
      telegram?: { enabled: boolean; botToken: string; chatId: string };
      apns?: {
        enabled: boolean;
        teamId: string;
        keyId: string;
        keyContent: string;
        bundleId: string;
        sandbox: boolean;
      };
    };
  }>("/api/settings/notifications", async (req, reply) => {
    const { telegram, apns } = req.body;
    const hasTelegram = telegram && typeof telegram.enabled === "boolean";
    const hasApns = apns && typeof apns.enabled === "boolean";
    if (!hasTelegram && !hasApns) {
      return reply.status(400).send({ error: "Invalid payload" });
    }
    const config = await loadConfig();
    if (hasTelegram) {
      config.notifications.telegram = {
        enabled: telegram.enabled,
        botToken: telegram.botToken?.trim() ?? "",
        chatId: telegram.chatId?.trim() ?? "",
      };
    }
    if (hasApns) {
      config.notifications.apns = {
        ...config.notifications.apns, // preserve deviceTokens
        enabled: apns.enabled,
        teamId: apns.teamId?.trim() ?? "",
        keyId: apns.keyId?.trim() ?? "",
        keyContent: apns.keyContent?.trim() ?? "",
        bundleId: apns.bundleId?.trim() ?? "",
        sandbox: apns.sandbox ?? false,
      };
    }
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

  app.post<{
    Body: { teamId: string; keyId: string; keyContent: string; bundleId: string; sandbox: boolean };
  }>("/api/settings/notifications/test-apns", async (req, reply) => {
    const { teamId, keyId, keyContent, bundleId, sandbox } = req.body;
    if (!teamId?.trim() || !keyId?.trim() || !keyContent?.trim() || !bundleId?.trim()) {
      return reply.status(400).send({ ok: false, error: "All APNs credentials are required" });
    }
    const config = await loadConfig();
    const tokens = config.notifications.apns.deviceTokens;
    const result = await ApnsChannel.sendTest(teamId, keyId, keyContent, bundleId, sandbox, tokens);
    return result;
  });

  app.post<{
    Body: { token: string };
  }>("/api/devices/apns", async (req, reply) => {
    const raw = req.body.token?.trim().toLowerCase().replace(/[^a-f0-9]/g, "");
    if (!raw || raw.length < 32) {
      return reply.status(400).send({ error: "Invalid device token" });
    }
    const config = await loadConfig();
    if (config.notifications.apns.deviceTokens.includes(raw)) {
      return { ok: true, added: false };
    }
    config.notifications.apns.deviceTokens.push(raw);
    await saveConfig(config);
    updateLiveApnsToken(raw);
    return { ok: true, added: true };
  });
}
