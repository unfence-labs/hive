import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScriptType } from "@/types";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  getServerUrl: vi.fn(),
}));

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: mocks.apiGet,
    post: mocks.apiPost,
  },
}));

vi.mock("@/hooks/useServerUrl", () => ({
  getServerUrl: mocks.getServerUrl,
}));

import { useScripts } from "@/hooks/useScripts";

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

  fireOpen() {
    this.onopen?.();
  }

  fireMessage(data: string | ArrayBuffer) {
    this.onmessage?.({ data });
  }

  fireClose() {
    this.onclose?.();
  }
}

interface MockTerminal {
  cols: number;
  rows: number;
  write: ReturnType<typeof vi.fn>;
  onData: (handler: (data: string) => void) => { dispose: ReturnType<typeof vi.fn> };
  onResize: (
    handler: (size: { cols: number; rows: number }) => void
  ) => { dispose: ReturnType<typeof vi.fn> };
  emitData: (data: string) => void;
  emitResize: (cols: number, rows: number) => void;
  inputDispose: ReturnType<typeof vi.fn>;
  resizeDispose: ReturnType<typeof vi.fn>;
}

function createTerminal(): MockTerminal {
  let dataHandler: ((data: string) => void) | null = null;
  let resizeHandler: ((size: { cols: number; rows: number }) => void) | null = null;
  const inputDispose = vi.fn();
  const resizeDispose = vi.fn();

  return {
    cols: 120,
    rows: 40,
    write: vi.fn(),
    onData: (handler: (data: string) => void) => {
      dataHandler = handler;
      return { dispose: inputDispose };
    },
    onResize: (handler: (size: { cols: number; rows: number }) => void) => {
      resizeHandler = handler;
      return { dispose: resizeDispose };
    },
    emitData: (data: string) => {
      dataHandler?.(data);
    },
    emitResize: (cols: number, rows: number) => {
      resizeHandler?.({ cols, rows });
    },
    inputDispose,
    resizeDispose,
  };
}

function scriptsResponse() {
  return {
    config: {
      scripts: {
        setup: "npm ci",
        run: "npm run dev",
      },
      port: 3000,
    },
    status: {
      setup: { state: "idle" as const },
      run: { state: "idle" as const },
    },
  };
}

describe("useScripts", () => {
  beforeEach(() => {
    mocks.apiGet.mockReset();
    mocks.apiPost.mockReset();
    mocks.getServerUrl.mockReset();
    mocks.getServerUrl.mockReturnValue("");
    mocks.apiGet.mockResolvedValue(scriptsResponse());
    mocks.apiPost.mockResolvedValue(undefined);
    MockWebSocket.instances.length = 0;
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
    delete import.meta.env.VITE_HIVE_AUTH_TOKEN;
    delete import.meta.env.VITE_WS_URL;
  });

  it("returns idle defaults when workspace id is undefined", async () => {
    const { result } = renderHook(() => useScripts(undefined));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mocks.apiGet).not.toHaveBeenCalled();
    expect(result.current.config).toBeNull();
    expect(result.current.status).toEqual({
      setup: { state: "idle" },
      run: { state: "idle" },
    });
  });

  it("fetches script config and status on mount", async () => {
    const { result } = renderHook(() => useScripts("ws-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mocks.apiGet).toHaveBeenCalledWith("/api/workspaces/ws-1/scripts");
    expect(result.current.config?.scripts?.setup).toBe("npm ci");
    expect(result.current.status.setup.state).toBe("idle");
  });

  it("starts a script and sets status to running on success", async () => {
    const { result } = renderHook(() => useScripts("ws-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.startScript("run");
    });

    expect(mocks.apiPost).toHaveBeenCalledWith("/api/workspaces/ws-1/scripts/run/start");
    expect(result.current.status.run.state).toBe("running");
  });

  it("refreshes from API when start fails", async () => {
    mocks.apiGet
      .mockResolvedValueOnce(scriptsResponse())
      .mockResolvedValueOnce({
        ...scriptsResponse(),
        status: {
          setup: { state: "idle" },
          run: { state: "done", exitCode: 0 },
        },
      });
    mocks.apiPost.mockRejectedValueOnce(new Error("already running"));

    const { result } = renderHook(() => useScripts("ws-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.startScript("run");
    });

    await waitFor(() => {
      expect(result.current.status.run.state).toBe("done");
      expect(result.current.status.run.exitCode).toBe(0);
    });
  });

  it("closes active websocket before stopping a script", async () => {
    const { result } = renderHook(() => useScripts("ws-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const term = createTerminal();

    act(() => {
      result.current.connectOutput("run", term as unknown as { cols: number; rows: number });
    });

    const ws = MockWebSocket.instances[0];
    if (!ws) throw new Error("expected websocket instance");

    await act(async () => {
      await result.current.stopScript("run");
    });

    expect(ws.close).toHaveBeenCalledTimes(1);
    expect(mocks.apiPost).toHaveBeenCalledWith("/api/workspaces/ws-1/scripts/run/stop");
    expect(result.current.status.run.state).toBe("idle");

    const closeCallOrder = ws.close.mock.invocationCallOrder[0];
    const postCallOrder = mocks.apiPost.mock.invocationCallOrder[0];
    expect(closeCallOrder).toBeLessThan(postCallOrder);
  });

  it("connects websocket with server URL + auth token and sends initial resize", async () => {
    mocks.getServerUrl.mockReturnValue("http://127.0.0.1:9000");
    import.meta.env.VITE_HIVE_AUTH_TOKEN = "  secret token  ";

    const { result } = renderHook(() => useScripts("ws-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const term = createTerminal();
    act(() => {
      result.current.connectOutput("setup", term as unknown as { cols: number; rows: number });
    });

    const ws = MockWebSocket.instances[0];
    if (!ws) throw new Error("expected websocket instance");

    expect(ws.url).toBe("ws://127.0.0.1:9000/ws/script/ws-1?type=setup&token=secret+token");

    act(() => {
      ws.fireOpen();
    });
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "resize", cols: 120, rows: 40 }),
    );
  });

  it("forwards terminal input and resize messages over websocket", async () => {
    const { result } = renderHook(() => useScripts("ws-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const term = createTerminal();
    act(() => {
      result.current.connectOutput("run", term as unknown as { cols: number; rows: number });
    });

    const ws = MockWebSocket.instances[0];
    if (!ws) throw new Error("expected websocket instance");

    act(() => {
      term.emitData("pwd\n");
      term.emitResize(88, 33);
    });

    const binaryPayload = ws.send.mock.calls.find((call) => ArrayBuffer.isView(call[0]))?.[0];
    expect(binaryPayload).toBeDefined();
    expect(new TextDecoder().decode(Uint8Array.from(binaryPayload as ArrayLike<number>))).toBe("pwd\n");
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "resize", cols: 88, rows: 33 }),
    );
  });

  it("updates script status when backend sends exit event", async () => {
    const { result } = renderHook(() => useScripts("ws-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const term = createTerminal();
    act(() => {
      result.current.connectOutput("setup", term as unknown as { cols: number; rows: number });
    });

    const ws = MockWebSocket.instances[0];
    if (!ws) throw new Error("expected websocket instance");

    act(() => {
      ws.fireMessage(JSON.stringify({ type: "exit", code: 0 }));
    });
    expect(result.current.status.setup).toEqual({ state: "done", exitCode: 0 });

    act(() => {
      ws.fireMessage(JSON.stringify({ type: "exit", code: 7 }));
    });
    expect(result.current.status.setup).toEqual({ state: "error", exitCode: 7 });
  });

  it("disposes terminal listeners when websocket closes", async () => {
    const { result } = renderHook(() => useScripts("ws-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const term = createTerminal();
    act(() => {
      result.current.connectOutput("run", term as unknown as { cols: number; rows: number });
    });

    const ws = MockWebSocket.instances[0];
    if (!ws) throw new Error("expected websocket instance");

    act(() => {
      ws.fireClose();
    });

    expect(term.inputDispose).toHaveBeenCalledTimes(1);
    expect(term.resizeDispose).toHaveBeenCalledTimes(1);
  });

  it("disconnectOutput closes the current websocket connection", async () => {
    const { result } = renderHook(() => useScripts("ws-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const term = createTerminal();
    act(() => {
      result.current.connectOutput("setup", term as unknown as { cols: number; rows: number });
    });

    const ws = MockWebSocket.instances[0];
    if (!ws) throw new Error("expected websocket instance");

    act(() => {
      result.current.disconnectOutput();
    });

    expect(ws.close).toHaveBeenCalledTimes(1);
  });

  it("replaces existing websocket when reconnecting to another script type", async () => {
    const { result } = renderHook(() => useScripts("ws-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const term1 = createTerminal();
    const term2 = createTerminal();

    act(() => {
      result.current.connectOutput("setup", term1 as unknown as { cols: number; rows: number });
      result.current.connectOutput("run", term2 as unknown as { cols: number; rows: number });
    });

    const firstWs = MockWebSocket.instances[0];
    const secondWs = MockWebSocket.instances[1];
    if (!firstWs || !secondWs) throw new Error("expected websocket instances");

    expect(firstWs.close).toHaveBeenCalledTimes(1);
    expect(secondWs.url).toContain("type=run");
  });

  it("does nothing for start/stop/connect when wsId is missing", async () => {
    const { result } = renderHook(() => useScripts(undefined));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const term = createTerminal();

    await act(async () => {
      await result.current.startScript("setup");
      await result.current.stopScript("setup");
      result.current.connectOutput("setup" as ScriptType, term as unknown as { cols: number; rows: number });
    });

    expect(mocks.apiPost).not.toHaveBeenCalled();
    expect(MockWebSocket.instances).toHaveLength(0);
  });
});
