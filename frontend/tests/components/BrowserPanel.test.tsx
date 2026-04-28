import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserPanel, __clearBrowserStreamConnectionsForTests } from "@/components/BrowserPanel";
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
      act(() => {
        this.readyState = MockWebSocket.OPEN;
        this.onopen?.();
      });
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
  streaming: true,
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
    act(() => __clearBrowserStreamConnectionsForTests());
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      writable: true,
      value: originalWebSocket,
    });
  });

  it("sends a fixed desktop viewport resize when the stream opens", async () => {
    render(<BrowserPanel status={status} />);

    await waitFor(() => {
      expect(MockWebSocket.instances[0]?.sent).toContain(JSON.stringify({
        type: "viewport_resize",
        width: 1280,
        height: 720,
      }));
    });
  });

  it("renders an idle header without opening a stream", () => {
    render(<BrowserPanel />);

    expect(screen.getByText("Browser")).toBeInTheDocument();
    expect(screen.getByText("not streaming")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Expand browser panel" })).not.toBeInTheDocument();
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("uses a small streaming label when the stream is active", async () => {
    render(<BrowserPanel status={status} />);

    await waitFor(() => expect(screen.getByText("streaming")).toBeInTheDocument());
  });

  it("renders stream frames without distorting the desktop viewport", async () => {
    render(<BrowserPanel status={status} />);

    await waitFor(() => expect(MockWebSocket.instances[0]?.readyState).toBe(MockWebSocket.OPEN));
    act(() => MockWebSocket.instances[0].onmessage?.({
      data: JSON.stringify({ type: "frame", data: "abc123" }),
    }));

    const frame = await screen.findByAltText("Agent browser");
    expect(frame).toHaveClass("h-full", "w-full", "object-contain");
  });

  it("does not open a stream socket while the browser status is stopped", () => {
    render(<BrowserPanel status={{ ...status, streaming: false }} />);

    expect(screen.getByText("not streaming")).toBeInTheDocument();
    expect(screen.getByText("Waiting for browser stream")).toBeInTheDocument();
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("stops showing streaming and clears the last frame when a stop status arrives", async () => {
    const { rerender } = render(<BrowserPanel status={status} />);

    await waitFor(() => expect(MockWebSocket.instances[0]?.readyState).toBe(MockWebSocket.OPEN));
    act(() => MockWebSocket.instances[0].onmessage?.({
      data: JSON.stringify({ type: "frame", data: "abc123" }),
    }));
    expect(await screen.findByAltText("Agent browser")).toBeInTheDocument();
    expect(screen.getByText("streaming")).toBeInTheDocument();

    rerender(<BrowserPanel status={{ ...status, streaming: false, updatedAt: 2 }} />);

    await waitFor(() => expect(screen.getByText("not streaming")).toBeInTheDocument());
    expect(screen.queryByAltText("Agent browser")).not.toBeInTheDocument();
  });

  it("stops showing streaming and clears the frame when the stream socket closes", async () => {
    render(<BrowserPanel status={status} />);

    await waitFor(() => expect(MockWebSocket.instances[0]?.readyState).toBe(MockWebSocket.OPEN));
    act(() => MockWebSocket.instances[0].onmessage?.({
      data: JSON.stringify({ type: "frame", data: "abc123" }),
    }));
    expect(await screen.findByAltText("Agent browser")).toBeInTheDocument();

    act(() => MockWebSocket.instances[0].close());

    await waitFor(() => expect(screen.getByText("not streaming")).toBeInTheDocument());
    expect(screen.queryByAltText("Agent browser")).not.toBeInTheDocument();
  });

  it("reconnects automatically when streaming restarts on the same browser session", async () => {
    const { rerender } = render(<BrowserPanel status={status} />);

    await waitFor(() => expect(MockWebSocket.instances[0]?.readyState).toBe(MockWebSocket.OPEN));
    act(() => MockWebSocket.instances[0].close());
    await waitFor(() => expect(screen.getByText("not streaming")).toBeInTheDocument());

    rerender(<BrowserPanel status={{ ...status, streaming: false, updatedAt: 2 }} />);
    rerender(<BrowserPanel status={{ ...status, streaming: true, updatedAt: 2 }} />);

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));
    await waitFor(() => expect(MockWebSocket.instances[1]?.readyState).toBe(MockWebSocket.OPEN));
  });

  it("keeps the viewport closed when collapsed", () => {
    render(<BrowserPanel status={status} collapsed onToggleCollapsed={() => {}} />);

    expect(screen.queryByAltText("Agent browser")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand browser panel" })).toBeInTheDocument();
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("keeps the browser stream connection alive across panel remounts", async () => {
    const first = render(<BrowserPanel status={status} />);
    await waitFor(() => expect(MockWebSocket.instances[0]?.readyState).toBe(MockWebSocket.OPEN));

    first.unmount();
    render(<BrowserPanel status={status} collapsed onToggleCollapsed={() => {}} />);

    expect(MockWebSocket.instances).toHaveLength(1);
  });
});
