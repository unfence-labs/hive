/**
 * Tests for Telegram message formatting of notification event types.
 * The original telegram.test.ts covers agent_turn_complete basics; this file
 * covers automation events and the newer notification variants.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { TelegramChannel } from "./telegram.js";
import type { NotificationEvent } from "./types.js";

type AutomationRunEvent = Extract<NotificationEvent, { type: "automation_run_complete" }>;
type NeedsInputEvent = Extract<NotificationEvent, { type: "agent_needs_input" }>;
type ProposedPlanEvent = Extract<NotificationEvent, { type: "agent_proposed_plan" }>;
type FailedEvent = Extract<NotificationEvent, { type: "agent_failed" }>;
type TurnCompleteEvent = Extract<NotificationEvent, { type: "agent_turn_complete" }>;

function automationEvent(overrides: Partial<AutomationRunEvent> = {}): AutomationRunEvent {
  return {
    type: "automation_run_complete",
    automationId: "auto-1",
    automationName: "Daily Code Review",
    status: "success",
    durationMs: 45000,
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

function mockFetch() {
  const mock = vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => "",
  })) as unknown as typeof fetch;
  vi.stubGlobal("fetch", mock);
  return vi.mocked(mock);
}

afterEach(() => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("automation_run_complete formatting", () => {
  it("formats successful automation run", async () => {
    const fetchMock = mockFetch();
    const channel = withEnv("token", "chat");

    await channel.send(
      automationEvent({
        summary: "Reviewed 12 files, found 3 issues.",
        durationMs: 120500,
      }),
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.text).toContain("Automation: Daily Code Review");
    expect(body.text).toContain("✅ Success");
    expect(body.text).toContain("Duration: 2m 1s");
    expect(body.text).toContain("Reviewed 12 files, found 3 issues.");
  });

  it("formats failed automation run with error", async () => {
    const fetchMock = mockFetch();
    const channel = withEnv("token", "chat");

    await channel.send(
      automationEvent({
        status: "failure",
        error: "Process exited with code 1",
      }),
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.text).toContain("❌ Failed");
    expect(body.text).toContain("Process exited with code 1");
    // Should not contain summary for failures
    expect(body.text).not.toContain("✅");
  });

  it("includes project name when available", async () => {
    const fetchMock = mockFetch();
    const channel = withEnv("token", "chat");

    await channel.send(
      automationEvent({ projectName: "my-project" }),
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.text).toContain("Project: my-project");
  });

  it("omits project name when not set", async () => {
    const fetchMock = mockFetch();
    const channel = withEnv("token", "chat");

    await channel.send(
      automationEvent({ projectName: undefined }),
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.text).not.toContain("Project:");
  });

  it("omits duration when not provided", async () => {
    const fetchMock = mockFetch();
    const channel = withEnv("token", "chat");

    await channel.send(
      automationEvent({ durationMs: undefined }),
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.text).not.toContain("Duration:");
  });

  it("escapes HTML in automation name", async () => {
    const fetchMock = mockFetch();
    const channel = withEnv("token", "chat");

    await channel.send(
      automationEvent({ automationName: "Review <main> & fix" }),
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.text).toContain("Review &lt;main&gt; &amp; fix");
  });

  it("truncates very long error messages", async () => {
    const fetchMock = mockFetch();
    const channel = withEnv("token", "chat");

    const longError = "x".repeat(5000);
    await channel.send(
      automationEvent({ status: "failure", error: longError }),
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    // Truncated to 4000 chars + ellipsis
    expect(body.text.length).toBeLessThan(5000);
    expect(body.text).toContain("…");
  });

  it("truncates very long summaries", async () => {
    const fetchMock = mockFetch();
    const channel = withEnv("token", "chat");

    const longSummary = "s".repeat(5000);
    await channel.send(
      automationEvent({ summary: longSummary }),
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.text.length).toBeLessThan(5000);
    expect(body.text).toContain("…");
  });

  it("shows summary for success and error for failure", async () => {
    const fetchMock = mockFetch();
    const channel = withEnv("token", "chat");

    // Success with both summary and error — should show summary
    await channel.send(
      automationEvent({
        status: "success",
        summary: "All good",
        error: "some ignored error",
      }),
    );

    let body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.text).toContain("All good");

    // Failure with both — should show error
    await channel.send(
      automationEvent({
        status: "failure",
        summary: "ignored summary",
        error: "real error",
      }),
    );

    body = JSON.parse(String(fetchMock.mock.calls[1]![1]?.body));
    expect(body.text).toContain("real error");
  });
});

const wsCtx = {
  workspaceId: "ws-1",
  workspaceName: "tokyo",
  projectName: "hive",
  sessionId: "s-1",
};

describe("agent_needs_input formatting", () => {
  it("formats with question mark emoji", async () => {
    const fetchMock = mockFetch();
    const channel = withEnv("token", "chat");
    const event: NeedsInputEvent = { type: "agent_needs_input", ...wsCtx };

    await channel.send(event);

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.text).toContain("❓");
    expect(body.text).toContain("Agent needs input");
    expect(body.text).toContain("Project: hive");
    expect(body.text).toContain("Workspace: tokyo");
  });
});

describe("agent_proposed_plan formatting", () => {
  it("formats with clipboard emoji", async () => {
    const fetchMock = mockFetch();
    const channel = withEnv("token", "chat");
    const event: ProposedPlanEvent = { type: "agent_proposed_plan", ...wsCtx };

    await channel.send(event);

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.text).toContain("📋");
    expect(body.text).toContain("Agent proposed a plan");
    expect(body.text).toContain("Workspace: tokyo");
  });
});

describe("agent_failed formatting", () => {
  it("formats with error detail and duration", async () => {
    const fetchMock = mockFetch();
    const channel = withEnv("token", "chat");
    const event: FailedEvent = {
      type: "agent_failed",
      ...wsCtx,
      durationMs: 92000,
      errorDetail: "exit code 1 | stderr: out of memory",
    };

    await channel.send(event);

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.text).toContain("❌");
    expect(body.text).toContain("Agent failed");
    expect(body.text).toContain("Duration: 1m 32s");
    expect(body.text).toContain("out of memory");
  });

  it("omits error detail when not provided", async () => {
    const fetchMock = mockFetch();
    const channel = withEnv("token", "chat");
    const event: FailedEvent = { type: "agent_failed", ...wsCtx };

    await channel.send(event);

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.text).toContain("Agent failed");
    expect(body.text).not.toContain("Duration:");
  });
});

describe("agent_turn_complete with summary", () => {
  it("includes summary when provided", async () => {
    const fetchMock = mockFetch();
    const channel = withEnv("token", "chat");
    const event: TurnCompleteEvent = {
      type: "agent_turn_complete",
      ...wsCtx,
      durationMs: 92000,
      summary: "Refactored 5 files and added tests.",
    };

    await channel.send(event);

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.text).toContain("Agent finished");
    expect(body.text).toContain("Duration: 1m 32s");
    expect(body.text).toContain("Refactored 5 files and added tests.");
  });

  it("omits summary when not provided", async () => {
    const fetchMock = mockFetch();
    const channel = withEnv("token", "chat");
    const event: TurnCompleteEvent = {
      type: "agent_turn_complete",
      ...wsCtx,
      durationMs: 5000,
    };

    await channel.send(event);

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.text).toContain("Agent finished");
    expect(body.text).toContain("Duration: 5s");
    // No trailing content after duration
    expect(body.text).not.toContain("\n\n");
  });
});
