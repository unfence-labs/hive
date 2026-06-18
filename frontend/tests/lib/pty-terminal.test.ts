import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Terminal as XTerm } from "@xterm/xterm";
import { connectPtyTerminal } from "@/lib/pty-terminal";

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
}

function createTerminal() {
  let dataHandler: ((data: string) => void) | null = null;
  let resizeHandler: ((size: { cols: number; rows: number }) => void) | null = null;
  const inputDispose = vi.fn();
  const resizeDispose = vi.fn();
  const term = {
    cols: 100,
    rows: 30,
    write: vi.fn(),
    onData: (handler: (data: string) => void) => {
      dataHandler = handler;
      return { dispose: inputDispose };
    },
    onResize: (handler: (size: { cols: number; rows: number }) => void) => {
      resizeHandler = handler;
      return { dispose: resizeDispose };
    },
  };
  return {
    term: term as unknown as XTerm,
    emitData: (d: string) => dataHandler?.(d),
    emitResize: (cols: number, rows: number) => resizeHandler?.({ cols, rows }),
    inputDispose,
    resizeDispose,
  };
}

function lastSocket(): MockWebSocket {
  const ws = MockWebSocket.instances.at(-1);
  if (!ws) throw new Error("expected websocket");
  return ws;
}

describe("connectPtyTerminal", () => {
  beforeEach(() => {
    MockWebSocket.instances.length = 0;
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
  });

  it("writes binary chunks to the terminal", () => {
    const { term } = createTerminal();
    connectPtyTerminal(term, "ws://x/ws/terminal/ws-1");
    lastSocket().onmessage?.({ data: new Uint8Array([1, 2, 3]).buffer });
    expect((term.write as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
  });

  it("sends an initial resize on open and forwards input + resize", () => {
    const t = createTerminal();
    connectPtyTerminal(t.term, "ws://x/ws/terminal/ws-1");
    const ws = lastSocket();

    ws.onopen?.();
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: "resize", cols: 100, rows: 30 }));

    t.emitData("ls\n");
    const binary = ws.send.mock.calls.find((c) => ArrayBuffer.isView(c[0]))?.[0];
    expect(new TextDecoder().decode(binary as Uint8Array)).toBe("ls\n");

    t.emitResize(120, 40);
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: "resize", cols: 120, rows: 40 }));
  });

  it("routes exit control frames through onExit and onControl", () => {
    const onExit = vi.fn();
    const onControl = vi.fn();
    const { term } = createTerminal();
    connectPtyTerminal(term, "ws://x/ws/terminal/ws-1", { onExit, onControl });
    lastSocket().onmessage?.({ data: JSON.stringify({ type: "exit", code: 7 }) });
    expect(onControl).toHaveBeenCalledWith({ type: "exit", code: 7 });
    expect(onExit).toHaveBeenCalledWith(7);
  });

  it("surfaces non-exit control frames through onControl only", () => {
    const onExit = vi.fn();
    const onControl = vi.fn();
    const { term } = createTerminal();
    connectPtyTerminal(term, "ws://x/ws/terminal/ws-1", { onExit, onControl });
    lastSocket().onmessage?.({ data: JSON.stringify({ type: "error", message: "No terminal process found" }) });
    expect(onControl).toHaveBeenCalledWith({ type: "error", message: "No terminal process found" });
    expect(onExit).not.toHaveBeenCalled();
  });

  it("defaults a code-less exit to -1", () => {
    const onExit = vi.fn();
    const { term } = createTerminal();
    connectPtyTerminal(term, "ws://x/ws/terminal/ws-1", { onExit });
    lastSocket().onmessage?.({ data: JSON.stringify({ type: "exit" }) });
    expect(onExit).toHaveBeenCalledWith(-1);
  });

  it("disposes listeners and closes the socket on disconnect", () => {
    const t = createTerminal();
    const disconnect = connectPtyTerminal(t.term, "ws://x/ws/terminal/ws-1");
    disconnect();
    expect(t.inputDispose).toHaveBeenCalledTimes(1);
    expect(t.resizeDispose).toHaveBeenCalledTimes(1);
    expect(lastSocket().close).toHaveBeenCalledTimes(1);
  });

  it("disposes listeners when the socket closes from the server", () => {
    const t = createTerminal();
    connectPtyTerminal(t.term, "ws://x/ws/terminal/ws-1");
    lastSocket().onclose?.();
    expect(t.inputDispose).toHaveBeenCalledTimes(1);
    expect(t.resizeDispose).toHaveBeenCalledTimes(1);
  });
});
