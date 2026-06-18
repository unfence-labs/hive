import { act, render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalPane } from "@/components/TerminalPane";

const mocks = vi.hoisted(() => ({
  apiPost: vi.fn(),
}));

vi.mock("@/hooks/useApi", () => ({
  api: { post: mocks.apiPost },
}));

vi.mock("@/hooks/useServerUrl", () => ({
  getServerUrl: () => "",
}));

const state = vi.hoisted(() => ({
  terminals: [] as Array<{ write: ReturnType<typeof vi.fn> }>,
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class TerminalMock {
    cols = 80;
    rows = 24;
    options: { theme?: unknown } = {};
    write = vi.fn();
    loadAddon = vi.fn();
    open = vi.fn();
    dispose = vi.fn();
    onData = vi.fn(() => ({ dispose: vi.fn() }));
    onResize = vi.fn(() => ({ dispose: vi.fn() }));
    constructor() {
      state.terminals.push(this);
    }
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class FitAddonMock {
    fit = vi.fn();
  },
}));

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  binaryType = "";
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
  onclose: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
  });

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  fireMessage(data: string | ArrayBuffer) {
    this.onmessage?.({ data });
  }
}

function lastSocket(): MockWebSocket {
  const ws = MockWebSocket.instances.at(-1);
  if (!ws) throw new Error("expected a websocket instance");
  return ws;
}

describe("TerminalPane", () => {
  beforeEach(() => {
    state.terminals.length = 0;
    MockWebSocket.instances.length = 0;
    mocks.apiPost.mockReset();
    mocks.apiPost.mockResolvedValue({ started: true });
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
  });

  it("connects to the terminal socket with the session id on mount", () => {
    render(<TerminalPane wsId="ws-1" sessionId="sess-1" />);
    expect(lastSocket().url).toBe("ws://localhost:3000/ws/terminal/ws-1?sessionId=sess-1");
  });

  it("shows no start overlay before the socket resolves (no flash on revisit)", () => {
    render(<TerminalPane wsId="ws-1" sessionId="sess-1" />);
    // Connecting state: while the socket is in flight, neither overlay button shows.
    expect(screen.queryByRole("button", { name: /start terminal/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /restart/i })).not.toBeInTheDocument();
  });

  it("offers a start button when the server reports no running PTY", () => {
    render(<TerminalPane wsId="ws-1" sessionId="sess-1" />);
    act(() => {
      lastSocket().fireMessage(JSON.stringify({ type: "error", message: "No terminal process found" }));
    });
    expect(screen.getByRole("button", { name: /start terminal/i })).toBeInTheDocument();
  });

  it("falls back to idle when the socket closes before resolving", () => {
    render(<TerminalPane wsId="ws-1" sessionId="sess-1" />);
    act(() => {
      lastSocket().onclose?.();
    });
    expect(screen.getByRole("button", { name: /start terminal/i })).toBeInTheDocument();
  });

  it("recovers to an idle overlay when the socket drops mid-session", () => {
    render(<TerminalPane wsId="ws-1" sessionId="sess-1" />);
    act(() => {
      lastSocket().fireMessage(JSON.stringify({ type: "ready" }));
    });
    expect(screen.queryByRole("button", { name: /start terminal/i })).not.toBeInTheDocument();

    // A mid-session drop must not leave the pane stuck on stale output: it
    // resolves to idle so the user can reconnect to the (likely still-alive) PTY.
    act(() => {
      lastSocket().onclose?.();
    });
    expect(screen.getByRole("button", { name: /start terminal/i })).toBeInTheDocument();
  });

  it("posts start then reconnects when the start button is clicked", async () => {
    render(<TerminalPane wsId="ws-1" sessionId="sess-1" />);
    act(() => {
      lastSocket().fireMessage(JSON.stringify({ type: "error", message: "No terminal process found" }));
    });

    const before = MockWebSocket.instances.length;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /start terminal/i }));
      await Promise.resolve();
    });

    expect(mocks.apiPost).toHaveBeenCalledWith("/api/workspaces/ws-1/terminal-tabs/sess-1/start");
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBeGreaterThan(before);
    });
    // No idle overlay once running.
    expect(screen.queryByRole("button", { name: /start terminal/i })).not.toBeInTheDocument();
  });

  it("hides the overlay once the PTY reports ready (running)", () => {
    render(<TerminalPane wsId="ws-1" sessionId="sess-1" />);
    act(() => {
      lastSocket().fireMessage(JSON.stringify({ type: "ready" }));
    });
    expect(screen.queryByRole("button", { name: /start terminal/i })).not.toBeInTheDocument();
  });

  it("treats binary PTY output as running and writes it to the terminal", () => {
    render(<TerminalPane wsId="ws-1" sessionId="sess-1" />);
    act(() => {
      lastSocket().fireMessage(new Uint8Array([104, 105]).buffer);
      // A ready frame flips state to running; binary alone keeps the terminal alive.
      lastSocket().fireMessage(JSON.stringify({ type: "ready" }));
    });
    expect(state.terminals[0].write).toHaveBeenCalledWith(new Uint8Array([104, 105]));
    expect(screen.queryByRole("button", { name: /start terminal/i })).not.toBeInTheDocument();
  });

  it("shows the exit code and a restart button when the PTY exits", async () => {
    render(<TerminalPane wsId="ws-1" sessionId="sess-1" />);
    act(() => {
      lastSocket().fireMessage(JSON.stringify({ type: "ready" }));
    });
    act(() => {
      lastSocket().fireMessage(JSON.stringify({ type: "exit", code: 137 }));
    });

    expect(screen.getByText(/Terminal exited \(code 137\)/i)).toBeInTheDocument();

    const before = MockWebSocket.instances.length;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /restart/i }));
      await Promise.resolve();
    });

    expect(mocks.apiPost).toHaveBeenCalledWith("/api/workspaces/ws-1/terminal-tabs/sess-1/start");
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBeGreaterThan(before);
    });
  });
});
