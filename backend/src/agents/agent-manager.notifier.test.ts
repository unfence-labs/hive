import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AppConfig } from "../state/config.js";

const mocks = vi.hoisted(() => ({
  notifierCtor: vi.fn(),
  fromConfig: vi.fn(),
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
    fromConfig: mocks.fromConfig,
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
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("rebuildNotifier", () => {
  it("builds notifier with no channels when telegram is disabled", () => {
    rebuildNotifier(makeConfig({ enabled: false, botToken: "token", chatId: "chat" }));

    expect(mocks.fromConfig).not.toHaveBeenCalled();
    expect(mocks.notifierCtor).toHaveBeenCalledWith([]);
  });

  it("builds notifier with telegram channel when enabled and valid", () => {
    const channel = { name: "telegram", isEnabled: () => true, send: vi.fn() };
    mocks.fromConfig.mockReturnValue(channel);

    rebuildNotifier(makeConfig({ enabled: true, botToken: "token", chatId: "chat" }));

    expect(mocks.fromConfig).toHaveBeenCalledWith({ botToken: "token", chatId: "chat", enabled: true });
    expect(mocks.notifierCtor).toHaveBeenCalledWith([channel]);
  });

  it("builds notifier with no channels when telegram config is invalid", () => {
    mocks.fromConfig.mockReturnValue(null);

    rebuildNotifier(makeConfig({ enabled: true, botToken: "", chatId: "" }));

    expect(mocks.fromConfig).toHaveBeenCalledWith({ botToken: "", chatId: "", enabled: true });
    expect(mocks.notifierCtor).toHaveBeenCalledWith([]);
  });
});
