import type { NotificationChannel, NotificationEvent } from "./types.js";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
