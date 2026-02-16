import { describe, it, expect, vi } from "vitest";
import { Notifier } from "./notifier.js";
import type { NotificationChannel, NotificationEvent } from "./types.js";

function eventFixture(): NotificationEvent {
  return {
    type: "agent_turn_complete",
    workspaceId: "ws-1",
    workspaceName: "tokyo",
    projectName: "fixture",
    sessionId: "sess-1",
    durationMs: 1200,
  };
}

function channelFixture(
  name: string,
  enabled: boolean,
  send = vi.fn(async (_event: NotificationEvent) => {}),
): { channel: NotificationChannel; send: typeof send } {
  const channel: NotificationChannel = {
    name,
    isEnabled: () => enabled,
    send,
  };
  return { channel, send };
}

describe("Notifier", () => {
  it("sends notifications to enabled channels", async () => {
    const first = channelFixture("first", true);
    const second = channelFixture("second", true);
    const notifier = new Notifier([first.channel, second.channel]);
    const event = eventFixture();

    await notifier.notify(event);

    expect(first.send).toHaveBeenCalledWith(event);
    expect(second.send).toHaveBeenCalledWith(event);
  });

  it("filters out disabled channels at construction", async () => {
    const enabled = channelFixture("enabled", true);
    const disabled = channelFixture("disabled", false);
    const notifier = new Notifier([enabled.channel, disabled.channel]);

    await notifier.notify(eventFixture());

    expect(enabled.send).toHaveBeenCalledTimes(1);
    expect(disabled.send).not.toHaveBeenCalled();
  });

  it("resolves even when one channel fails", async () => {
    const ok = channelFixture("ok", true);
    const failing = channelFixture(
      "failing",
      true,
      vi.fn(async () => {
        throw new Error("boom");
      }),
    );
    const notifier = new Notifier([ok.channel, failing.channel]);

    await expect(notifier.notify(eventFixture())).resolves.toBeUndefined();
    expect(ok.send).toHaveBeenCalledTimes(1);
    expect(failing.send).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when no channel is enabled", async () => {
    const disabled = channelFixture("disabled", false);
    const notifier = new Notifier([disabled.channel]);

    await expect(notifier.notify(eventFixture())).resolves.toBeUndefined();
    expect(disabled.send).not.toHaveBeenCalled();
  });
});
