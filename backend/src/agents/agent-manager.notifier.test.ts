import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AppConfig } from "../state/config.js";

const mocks = vi.hoisted(() => ({
  notifierCtor: vi.fn(),
  telegramFromConfig: vi.fn(),
}));

vi.mock("../notifications/notifier.js", () => ({
  Notifier: class Notifier {
    constructor(channels: unknown[]) {
      mocks.notifierCtor(channels);
    }

    async notify(): Promise<void> {}
  },
}));

vi.mock("../notifications/telegram.js", () => ({
  TelegramChannel: {
    fromConfig: mocks.telegramFromConfig,
  },
}));

import { rebuildNotifier } from "./agent-manager.js";

function makeConfig(overrides?: Partial<AppConfig["notifications"]["telegram"]>): AppConfig {
  return {
    notifications: {
      telegram: {
        enabled: false,
        botToken: "",
        chatId: "",
        ...overrides,
      },
    },
    kimi: { apiKey: "" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("rebuildNotifier", () => {
  it("builds notifier with no channels when telegram is disabled", () => {
    rebuildNotifier(makeConfig({ enabled: false, botToken: "token", chatId: "chat" }));

    expect(mocks.telegramFromConfig).not.toHaveBeenCalled();
    expect(mocks.notifierCtor).toHaveBeenCalledWith([]);
  });

  it("builds notifier with telegram channel when enabled and valid", () => {
    const channel = { name: "telegram", isEnabled: () => true, send: vi.fn() };
    mocks.telegramFromConfig.mockReturnValue(channel);

    rebuildNotifier(makeConfig({ enabled: true, botToken: "token", chatId: "chat" }));

    expect(mocks.telegramFromConfig).toHaveBeenCalledWith({ botToken: "token", chatId: "chat", enabled: true });
    expect(mocks.notifierCtor).toHaveBeenCalledWith([channel]);
  });

  it("builds notifier with no channels when telegram config is invalid", () => {
    mocks.telegramFromConfig.mockReturnValue(null);

    rebuildNotifier(makeConfig({ enabled: true, botToken: "", chatId: "" }));

    expect(mocks.telegramFromConfig).toHaveBeenCalledWith({ botToken: "", chatId: "", enabled: true });
    expect(mocks.notifierCtor).toHaveBeenCalledWith([]);
  });
});
