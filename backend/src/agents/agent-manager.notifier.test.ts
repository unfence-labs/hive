import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AppConfig } from "../state/config.js";

const mocks = vi.hoisted(() => ({
  notifierCtor: vi.fn(),
  telegramFromConfig: vi.fn(),
  apnsFromConfig: vi.fn(),
  apnsDestroy: vi.fn(),
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

vi.mock("../notifications/apns.js", () => ({
  ApnsChannel: {
    fromConfig: mocks.apnsFromConfig,
  },
}));

vi.mock("../state/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../state/config.js")>();
  return { ...actual, loadConfig: vi.fn(), saveConfig: vi.fn() };
});

import { rebuildNotifier } from "./agent-manager.js";

const DEFAULT_APNS = { enabled: false, teamId: "", keyId: "", keyContent: "", bundleId: "", sandbox: false, deviceTokens: [] as string[] };

const DEFAULT_CLEANUP = {
  postRunArtifactStrip: true,
  artifactDirs: ["node_modules", "target", ".next", "dist", "build", "__pycache__", ".gradle", ".cache", ".parcel-cache"],
  ttl: { archivedWorkspaceDays: 30, runSessionDeleteDays: 30, keepMinRuns: 5, sweepIntervalHours: 6 },
  disk: { softThresholdPercent: 80, hardThresholdPercent: 90, checkIntervalSeconds: 60 },
};

function makeConfig(overrides?: Partial<AppConfig["notifications"]["telegram"]>): AppConfig {
  return {
    notifications: {
      telegram: {
        enabled: false,
        botToken: "",
        chatId: "",
        ...overrides,
      },
      apns: { ...DEFAULT_APNS },
    },
    cleanup: { ...DEFAULT_CLEANUP },
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

  it("includes apns channel when enabled and valid", () => {
    const apnsCh = { name: "apns", isEnabled: () => true, send: vi.fn(), destroy: mocks.apnsDestroy };
    mocks.apnsFromConfig.mockReturnValue(apnsCh);

    const config: AppConfig = {
      notifications: {
        telegram: { enabled: false, botToken: "", chatId: "" },
        apns: { enabled: true, teamId: "T", keyId: "K", keyContent: "PEM", bundleId: "com.x", sandbox: false, deviceTokens: [] },
      },
      cleanup: { ...DEFAULT_CLEANUP },
    };
    rebuildNotifier(config);

    expect(mocks.apnsFromConfig).toHaveBeenCalled();
    expect(mocks.notifierCtor).toHaveBeenCalledWith([apnsCh]);
  });

  it("destroys previous apns channel on rebuild", () => {
    // Clear any lingering liveApnsChannel from previous tests
    rebuildNotifier(makeConfig());
    vi.clearAllMocks();

    const apnsCh = { name: "apns", isEnabled: () => true, send: vi.fn(), destroy: mocks.apnsDestroy };
    mocks.apnsFromConfig.mockReturnValue(apnsCh);

    const config: AppConfig = {
      notifications: {
        telegram: { enabled: false, botToken: "", chatId: "" },
        apns: { enabled: true, teamId: "T", keyId: "K", keyContent: "PEM", bundleId: "com.x", sandbox: false, deviceTokens: [] },
      },
      cleanup: { ...DEFAULT_CLEANUP },
    };
    rebuildNotifier(config);
    rebuildNotifier(config);

    expect(mocks.apnsDestroy).toHaveBeenCalledTimes(1);
  });
});
