import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Terminal from "@/components/Terminal";

const state = vi.hoisted(() => ({
  terminals: [] as Array<{
    cols: number;
    rows: number;
    loadAddon: ReturnType<typeof vi.fn>;
    open: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    onData: ReturnType<typeof vi.fn>;
    onResize: ReturnType<typeof vi.fn>;
    emitData: (data: string) => void;
    emitResize: (cols: number, rows: number) => void;
  }>,
  fitAddons: [] as Array<{ fit: ReturnType<typeof vi.fn> }>,
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class TerminalMock {
    cols = 120;
    rows = 40;
    private dataHandler: ((data: string) => void) | null = null;
    private resizeHandler: ((size: { cols: number; rows: number }) => void) | null = null;
    loadAddon = vi.fn();
    open = vi.fn();
    focus = vi.fn();
    write = vi.fn();
    dispose = vi.fn();
    onData = vi.fn((handler: (data: string) => void) => {
      this.dataHandler = handler;
      return { dispose: vi.fn() };
    });
    onResize = vi.fn((handler: (size: { cols: number; rows: number }) => void) => {
      this.resizeHandler = handler;
      return { dispose: vi.fn() };
    });

    constructor() {
      state.terminals.push(this);
    }

    emitData(data: string) {
      this.dataHandler?.(data);
    }

    emitResize(cols: number, rows: number) {
      this.resizeHandler?.({ cols, rows });
    }
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class FitAddonMock {
    fit = vi.fn();
    constructor() {
      state.fitAddons.push(this);
    }
  },
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class WebLinksAddonMock {},
}));

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  binaryType = "";
  readyState = MockWebSocket.OPEN;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
  });

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  fireOpen() {
    this.onopen?.(new Event("open"));
  }

  fireMessage(data: string | ArrayBuffer) {
    this.onmessage?.({ data } as MessageEvent);
  }

  fireError() {
    this.onerror?.(new Event("error"));
  }

  fireClose() {
    this.onclose?.({} as CloseEvent);
  }
}

function getFirstWebSocket() {
  const ws = MockWebSocket.instances[0];
  if (!ws) throw new Error("expected websocket to be created");
  return ws;
}

function getFirstTerminal() {
  const term = state.terminals[0];
  if (!term) throw new Error("expected terminal instance to be created");
  return term;
}

describe("Terminal", () => {
  beforeEach(() => {
    state.terminals.length = 0;
    state.fitAddons.length = 0;
    MockWebSocket.instances.length = 0;
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
    localStorage.removeItem("hive-server-url");
    delete import.meta.env.VITE_WS_URL;
    delete import.meta.env.VITE_HIVE_AUTH_TOKEN;
  });

  it("sends initial terminal size when websocket opens", () => {
    render(<Terminal workspaceId="ws-1" />);
    const ws = getFirstWebSocket();
    act(() => {
      ws.fireOpen();
    });

    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: "resize", cols: 120, rows: 40 }));
  });

  it("uses configured server URL as websocket host", () => {
    localStorage.setItem("hive-server-url", "http://127.0.0.1:9000");

    render(<Terminal workspaceId="ws-1" />);
    const ws = getFirstWebSocket();

    expect(ws.url).toBe("ws://127.0.0.1:9000/ws/terminal/ws-1");
  });

  it("maps https configured server URL to wss websocket host", () => {
    localStorage.setItem("hive-server-url", "https://api.example.com");

    render(<Terminal workspaceId="ws-1" />);
    const ws = getFirstWebSocket();

    expect(ws.url).toBe("wss://api.example.com/ws/terminal/ws-1");
  });

  it("falls back to VITE_WS_URL when no server URL is configured", () => {
    import.meta.env.VITE_WS_URL = "ws://dev.example.test:8080";

    render(<Terminal workspaceId="ws-1" />);
    const ws = getFirstWebSocket();

    expect(ws.url).toBe("ws://dev.example.test:8080/ws/terminal/ws-1");
  });

  it("appends auth token query parameter when configured", () => {
    localStorage.setItem("hive-server-url", "http://127.0.0.1:9000");
    import.meta.env.VITE_HIVE_AUTH_TOKEN = "secret token";

    render(<Terminal workspaceId="ws-1" />);
    const ws = getFirstWebSocket();

    expect(ws.url).toBe("ws://127.0.0.1:9000/ws/terminal/ws-1?token=secret%20token");
  });

  it("forwards terminal input as binary websocket payload", () => {
    render(<Terminal workspaceId="ws-1" />);
    const ws = getFirstWebSocket();
    const term = getFirstTerminal();

    act(() => {
      term.emitData("ls\n");
    });

    expect(ws.send).toHaveBeenCalledTimes(1);
    const payload = ws.send.mock.calls[0]?.[0];
    expect(ArrayBuffer.isView(payload)).toBe(true);
    expect(new TextDecoder().decode(Uint8Array.from(payload as ArrayLike<number>))).toBe("ls\n");
  });

  it("calls onExit callback when backend sends exit event", () => {
    const onExit = vi.fn();
    render(<Terminal workspaceId="ws-1" onExit={onExit} />);
    const ws = getFirstWebSocket();

    act(() => {
      ws.fireMessage(JSON.stringify({ type: "exit", code: 0 }));
    });

    expect(onExit).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Session ended/i)).not.toBeInTheDocument();
  });

  it("shows backend error message overlay", async () => {
    render(<Terminal workspaceId="ws-1" />);
    const ws = getFirstWebSocket();

    act(() => {
      ws.fireMessage(JSON.stringify({ type: "error", message: "PTY failed" }));
    });

    expect(await screen.findByText("PTY failed")).toBeInTheDocument();
  });

  it("shows fallback connection overlay on websocket error", async () => {
    render(<Terminal workspaceId="ws-1" />);
    const ws = getFirstWebSocket();

    act(() => {
      ws.fireError();
    });

    expect(await screen.findByText("Connection failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeInTheDocument();
  });

  it("re-fits and refocuses when visible turns true", async () => {
    const { rerender } = render(<Terminal workspaceId="ws-1" visible={false} />);
    const term = getFirstTerminal();
    const fitAddon = state.fitAddons[0];

    expect(fitAddon?.fit).toHaveBeenCalledTimes(1);
    expect(term.focus).toHaveBeenCalledTimes(1);

    rerender(<Terminal workspaceId="ws-1" visible />);

    await waitFor(() => {
      expect(fitAddon?.fit).toHaveBeenCalledTimes(2);
      expect(term.focus).toHaveBeenCalledTimes(2);
    });
  });

  it("cleans up websocket and terminal instance on unmount", () => {
    const { unmount } = render(<Terminal workspaceId="ws-1" />);
    const ws = getFirstWebSocket();
    const term = getFirstTerminal();

    unmount();

    expect(ws.close).toHaveBeenCalledTimes(1);
    expect(term.dispose).toHaveBeenCalledTimes(1);
  });
});
