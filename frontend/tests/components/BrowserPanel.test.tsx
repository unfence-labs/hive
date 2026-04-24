import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserPanel } from "@/components/BrowserPanel";
import type { BrowserStatusPayload } from "@/types";

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;

  static instances: MockWebSocket[] = [];

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  binaryType = "";
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    });
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

const status: BrowserStatusPayload = {
  sessionId: "session-1",
  state: "active",
  streamPath: "/ws/browser/ws-1/session-1",
  updatedAt: 1,
};

const originalWebSocket = globalThis.WebSocket;

describe("BrowserPanel", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 640,
      height: 360,
      top: 0,
      right: 640,
      bottom: 360,
      left: 0,
      toJSON: () => ({}),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      writable: true,
      value: originalWebSocket,
    });
  });

  it("sends the panel dimensions as a viewport resize when the stream opens", async () => {
    render(<BrowserPanel status={status} />);

    await waitFor(() => {
      expect(MockWebSocket.instances[0]?.sent).toContain(JSON.stringify({
        type: "viewport_resize",
        width: 640,
        height: 360,
      }));
    });
  });

  it("renders an idle header without opening a stream", () => {
    render(<BrowserPanel />);

    expect(screen.getByText("Browser")).toBeInTheDocument();
    expect(screen.getByText("Idle")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Expand browser panel" })).not.toBeInTheDocument();
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("renders stream frames as a full panel viewport", async () => {
    render(<BrowserPanel status={status} />);

    await waitFor(() => expect(MockWebSocket.instances[0]?.readyState).toBe(MockWebSocket.OPEN));
    act(() => MockWebSocket.instances[0].onmessage?.({
      data: JSON.stringify({ type: "frame", data: "abc123" }),
    }));

    const frame = await screen.findByAltText("Agent browser");
    expect(frame).toHaveClass("h-full", "w-full", "object-fill");
  });

  it("keeps the viewport closed when collapsed", () => {
    render(<BrowserPanel status={status} collapsed onToggleCollapsed={() => {}} />);

    expect(screen.queryByAltText("Agent browser")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand browser panel" })).toBeInTheDocument();
    expect(MockWebSocket.instances).toHaveLength(0);
  });
});
