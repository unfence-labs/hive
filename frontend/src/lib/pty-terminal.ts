import type { Terminal as XTerm } from "@xterm/xterm";

/** JSON control messages a PTY WebSocket can send to the client. */
export interface PtyControlMessage {
  type: string;
  code?: number;
  message?: string;
}

export interface ConnectPtyTerminalOptions {
  /** Invoked when the PTY emits an `exit` control message. */
  onExit?: (code: number) => void;
  /**
   * Invoked for every non-binary (JSON control) message from the server, e.g.
   * `{type:"ready"}`, `{type:"error",message}`. `exit` is still routed through
   * `onExit` in addition to this callback.
   */
  onControl?: (msg: PtyControlMessage) => void;
  /**
   * Invoked when the socket closes on its own (server end or network failure),
   * NOT when the returned disconnect function is called. Lets a caller resolve a
   * still-pending "connecting" state if the socket dies before any control frame.
   */
  onClose?: () => void;
}

/**
 * Bridge a PTY WebSocket to an xterm instance: binary chunks are written to the
 * terminal, terminal input/resize are forwarded to the socket, and JSON control
 * frames are surfaced via callbacks. Returns a disconnect function that closes
 * the socket and disposes the terminal listeners.
 *
 * Shared by the bottom-right ScriptPanel terminal (`/ws/script`) and the
 * full-pane TerminalPane (`/ws/terminal`).
 */
export function connectPtyTerminal(
  term: XTerm,
  url: string,
  options: ConnectPtyTerminalOptions = {},
): () => void {
  const { onExit, onControl, onClose } = options;
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";

  const encoder = new TextEncoder();

  ws.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
      term.write(new Uint8Array(event.data));
      return;
    }
    try {
      const msg = JSON.parse(event.data as string) as PtyControlMessage;
      onControl?.(msg);
      if (msg.type === "exit") {
        onExit?.(msg.code ?? -1);
      }
    } catch {
      // Ignore malformed control frames.
    }
  };

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
  };

  const inputDisposable = term.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(encoder.encode(data));
    }
  });

  const resizeDisposable = term.onResize(({ cols, rows }) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  });

  ws.onclose = () => {
    inputDisposable.dispose();
    resizeDisposable.dispose();
    onClose?.();
  };

  return () => {
    inputDisposable.dispose();
    resizeDisposable.dispose();
    ws.onclose = null;
    ws.close();
  };
}
