import type { NotificationChannel, NotificationEvent } from "./types.js";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncate(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : text.slice(0, maxLen - 1) + "…";
}

function formatMessage(event: NotificationEvent): string {
  switch (event.type) {
    case "agent_turn_complete": {
      const duration =
        event.durationMs != null ? `\nDuration: ${Math.round(event.durationMs / 1000)}s` : "";
      return (
        `🤖 <b>Agent finished</b>\n` +
        `Project: ${escapeHtml(event.projectName)}\n` +
        `Workspace: ${escapeHtml(event.workspaceName)}` +
        duration
      );
    }
    case "automation_run_complete": {
      const statusIcon = event.status === "success" ? "✅" : "❌";
      const statusLabel = event.status === "success" ? "Success" : "Failed";
      const duration =
        event.durationMs != null ? `\nDuration: ${Math.round(event.durationMs / 1000)}s` : "";
      const project = event.projectName ? `\nProject: ${escapeHtml(event.projectName)}` : "";

      let body = "";
      if (event.status === "failure" && event.error) {
        body = `\n\n${escapeHtml(truncate(event.error, 4000))}`;
      } else if (event.summary) {
        body = `\n\n${escapeHtml(truncate(event.summary, 4000))}`;
      }

      return (
        `🤖 <b>Automation: ${escapeHtml(event.automationName)}</b>${project}\n` +
        `Status: ${statusIcon} ${statusLabel}` +
        duration +
        body
      );
    }
  }
}

export class TelegramChannel implements NotificationChannel {
  readonly name = "telegram";

  private constructor(
    private readonly botToken: string,
    private readonly chatId: string,
  ) {}

  /** Returns a configured channel, or null if env vars are missing. */
  static fromEnv(): TelegramChannel | null {
    const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
    const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
    if (!botToken || !chatId) return null;
    return new TelegramChannel(botToken, chatId);
  }

  /** Returns a configured channel from explicit config, or null if credentials are missing. */
  static fromConfig(cfg: { botToken: string; chatId: string }): TelegramChannel | null {
    const botToken = cfg.botToken?.trim();
    const chatId = cfg.chatId?.trim();
    if (!botToken || !chatId) return null;
    return new TelegramChannel(botToken, chatId);
  }

  /** Sends a test message and returns success/failure. */
  static async sendTest(
    botToken: string,
    chatId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const token = botToken.trim();
    const chat = chatId.trim();
    if (!token || !chat) return { ok: false, error: "Bot token and chat ID are required" };
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chat,
            text: "✅ Hive test notification — your Telegram integration is working!",
            parse_mode: "HTML",
          }),
        },
      );
      if (!res.ok) {
        const body = await res.text();
        let errorMsg = `Telegram API error (${res.status})`;
        try {
          const parsed = JSON.parse(body) as { description?: string };
          if (parsed.description) errorMsg = parsed.description;
        } catch { /* use default */ }
        return { ok: false, error: errorMsg };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Network error" };
    }
  }

  isEnabled(): boolean {
    return true;
  }

  async send(event: NotificationEvent): Promise<void> {
    const text = formatMessage(event);
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${this.botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: this.chatId,
            text,
            parse_mode: "HTML",
          }),
        },
      );
      if (!res.ok) {
        const body = await res.text();
        console.error(`[telegram] send failed (${res.status}):`, body);
      }
    } catch (err) {
      console.error("[telegram] send error:", err);
    }
  }
}
