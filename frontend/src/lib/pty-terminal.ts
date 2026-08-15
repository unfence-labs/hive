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

interface ActivePtyTerminal {
  reconnect: () => void;
  disconnect: () => void;
}

const activePtyTerminals = new Set<ActivePtyTerminal>();

export function reconnectActivePtyTerminals(): void {
  for (const connection of activePtyTerminals) {
    connection.reconnect();
  }
}

export function __clearPtyTerminalConnectionsForTests(): void {
  for (const connection of [...activePtyTerminals]) {
    connection.disconnect();
  }
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
  const encoder = new TextEncoder();
  let ws: WebSocket | null = null;
  let connected = true;

  const inputDisposable = term.onData((data) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(encoder.encode(data));
    }
  });

  const resizeDisposable = term.onResize(({ cols, rows }) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  });

  const disconnect = () => {
    if (!connected) return;
    connected = false;
    activePtyTerminals.delete(connection);
    inputDisposable.dispose();
    resizeDisposable.dispose();
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
  };

  const connect = () => {
    const previous = ws;
    let resetPending = previous !== null;
    if (previous) {
      previous.onclose = null;
      previous.close();
    }

    const next = new WebSocket(url);
    ws = next;
    next.binaryType = "arraybuffer";

    next.onmessage = (event) => {
      if (ws !== next) return;
      if (event.data instanceof ArrayBuffer) {
        if (resetPending) {
          term.reset();
          resetPending = false;
        }
        term.write(new Uint8Array(event.data));
        return;
      }
      try {
        const msg = JSON.parse(event.data as string) as PtyControlMessage;
        if (resetPending) {
          term.reset();
          resetPending = false;
        }
        onControl?.(msg);
        if (msg.type === "exit") {
          onExit?.(msg.code ?? -1);
        }
      } catch {
        // Ignore malformed control frames.
      }
    };

    next.onopen = () => {
      if (ws !== next) return;
      next.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };

    next.onclose = () => {
      if (ws !== next || !connected) return;
      connected = false;
      activePtyTerminals.delete(connection);
      inputDisposable.dispose();
      resizeDisposable.dispose();
      onClose?.();
    };
  };

  const connection: ActivePtyTerminal = { reconnect: connect, disconnect };
  activePtyTerminals.add(connection);
  connect();

  return disconnect;
}
