import { afterEach, describe, expect, it, vi } from "vitest";
import { TelegramChannel } from "./telegram.js";
import type { NotificationEvent } from "./types.js";

type AgentTurnEvent = Extract<NotificationEvent, { type: "agent_turn_complete" }>;

function eventFixture(overrides: Partial<AgentTurnEvent> = {}): AgentTurnEvent {
  return {
    type: "agent_turn_complete",
    workspaceId: "ws-1",
    workspaceName: "tokyo",
    projectName: "fixture",
    sessionId: "sess-1",
    durationMs: 2001,
    ...overrides,
  };
}

function withEnv(botToken: string, chatId: string): TelegramChannel {
  process.env.TELEGRAM_BOT_TOKEN = botToken;
  process.env.TELEGRAM_CHAT_ID = chatId;
  const channel = TelegramChannel.fromEnv();
  if (!channel) throw new Error("expected TelegramChannel");
  return channel;
}

afterEach(() => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TelegramChannel.fromEnv", () => {
  it("returns null when required env vars are missing", () => {
    expect(TelegramChannel.fromEnv()).toBeNull();
    process.env.TELEGRAM_BOT_TOKEN = "token";
    expect(TelegramChannel.fromEnv()).toBeNull();
    delete process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_CHAT_ID = "chat";
    expect(TelegramChannel.fromEnv()).toBeNull();
  });

  it("returns null for blank env vars", () => {
    process.env.TELEGRAM_BOT_TOKEN = " ";
    process.env.TELEGRAM_CHAT_ID = "chat";
    expect(TelegramChannel.fromEnv()).toBeNull();

    process.env.TELEGRAM_BOT_TOKEN = "token";
    process.env.TELEGRAM_CHAT_ID = "   ";
    expect(TelegramChannel.fromEnv()).toBeNull();
  });

  it("returns a configured channel when env vars are present", () => {
    const channel = withEnv("token", "chat");
    expect(channel).toBeDefined();
    expect(channel.isEnabled()).toBe(true);
  });
});

describe("TelegramChannel.fromConfig", () => {
  it("returns null when credentials are blank", () => {
    expect(TelegramChannel.fromConfig({ botToken: "", chatId: "chat" })).toBeNull();
    expect(TelegramChannel.fromConfig({ botToken: "token", chatId: "   " })).toBeNull();
  });

  it("trims credentials before creating channel", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "",
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const channel = TelegramChannel.fromConfig({ botToken: " token ", chatId: " chat " });
    expect(channel).toBeDefined();

    await channel!.send(eventFixture());

    const [url, init] = vi.mocked(fetchMock).mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/bottoken/sendMessage");
    const body = JSON.parse(String(init?.body));
    expect(body.chat_id).toBe("chat");
  });
});

describe("TelegramChannel.sendTest", () => {
  it("returns validation error when credentials are missing", async () => {
    await expect(TelegramChannel.sendTest("", "chat")).resolves.toEqual({
      ok: false,
      error: "Bot token and chat ID are required",
    });
  });

  it("sends a test notification with trimmed credentials", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "",
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const result = await TelegramChannel.sendTest(" token ", " chat ");

    expect(result).toEqual({ ok: true });
    const [url, init] = vi.mocked(fetchMock).mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/bottoken/sendMessage");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "Content-Type": "application/json" });
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({
      chat_id: "chat",
      text: "✅ Hive test notification — your Telegram integration is working!",
      parse_mode: "HTML",
    });
  });

  it("returns Telegram description when API responds with JSON error", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ description: "Unauthorized" }),
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const result = await TelegramChannel.sendTest("token", "chat");

    expect(result).toEqual({ ok: false, error: "Unauthorized" });
  });

  it("returns fallback error when API error body is not JSON", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => "bad gateway",
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const result = await TelegramChannel.sendTest("token", "chat");

    expect(result).toEqual({ ok: false, error: "Telegram API error (500)" });
  });

  it("returns network error when fetch throws", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const result = await TelegramChannel.sendTest("token", "chat");

    expect(result).toEqual({ ok: false, error: "network down" });
  });
});

describe("TelegramChannel.send", () => {
  it("posts an escaped HTML message with rounded duration", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "",
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);
    const channel = withEnv(" token ", " chat ");

    await channel.send(
      eventFixture({
        workspaceName: "tokyo <main>",
        projectName: "fixture & api",
        durationMs: 1499,
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetchMock).mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/bottoken/sendMessage");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "Content-Type": "application/json" });

    const body = JSON.parse(String(init?.body));
    expect(body.chat_id).toBe("chat");
    expect(body.parse_mode).toBe("HTML");
    expect(body.text).toContain("Project: fixture &amp; api");
    expect(body.text).toContain("Workspace: tokyo &lt;main&gt;");
    expect(body.text).toContain("Duration: 1s");
  });

  it("omits duration line when duration is missing", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "",
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);
    const channel = withEnv("token", "chat");

    await channel.send(eventFixture({ durationMs: undefined }));

    const [, init] = vi.mocked(fetchMock).mock.calls[0]!;
    const body = JSON.parse(String(init?.body));
    expect(body.text).not.toContain("Duration:");
  });

  it("logs an error when Telegram API returns a non-ok response", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => "bad gateway",
    })) as unknown as typeof fetch;
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", fetchMock);
    const channel = withEnv("token", "chat");

    await channel.send(eventFixture());

    expect(consoleSpy).toHaveBeenCalledWith("[telegram] send failed (500):", "bad gateway");
  });

  it("logs an error when fetch throws", async () => {
    const err = new Error("network down");
    const fetchMock = vi.fn(async () => {
      throw err;
    }) as unknown as typeof fetch;
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", fetchMock);
    const channel = withEnv("token", "chat");

    await channel.send(eventFixture());

    expect(consoleSpy).toHaveBeenCalledWith("[telegram] send error:", err);
  });
});
