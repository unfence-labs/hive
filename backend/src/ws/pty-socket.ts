import type { WebSocket } from "ws";
import { nanoid } from "nanoid";
import type { PtyProcess } from "../services/pty-process.js";

const PING_INTERVAL_MS = 30_000;

/**
 * Bridge a WebSocket to a {@link PtyProcess}.
 *
 * Replays the buffered output verbatim, then either sends an immediate `exit`
 * for a finished process or wires live output, bidirectional input (binary →
 * `pty.write`, JSON `{type:"resize"}` → `pty.resize`), a keep-alive ping, and
 * listener cleanup on close. Shared by `/ws/script` and `/ws/terminal` so the
 * protocol stays identical without duplicating the handler body.
 */
export function attachPtyToSocket(socket: WebSocket, proc: PtyProcess): void {
  // Replay buffered output verbatim (preserves \r\n, ANSI escapes, cursor
  // positioning). Splitting/rejoining the stream corrupts xterm rendering.
  if (proc.outputBuffer.length > 0) {
    if (socket.readyState === socket.OPEN) {
      socket.send(Buffer.from(proc.outputBuffer), { binary: true });
    }
  }

  // If the process already finished, send exit and close — there is nothing
  // left to stream, so an idle open socket would just leak a connection.
  if (proc.state !== "running") {
    socket.send(JSON.stringify({ type: "exit", code: proc.exitCode ?? -1 }));
    socket.close();
    return;
  }

  // Wire live output
  const listenerId = nanoid(8);

  proc.listeners.set(listenerId, (data) => {
    if (socket.readyState === socket.OPEN) {
      socket.send(Buffer.from(data), { binary: true });
    }
  });

  proc.exitListeners.set(listenerId, (code) => {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ type: "exit", code }));
      // The PTY is gone; close the socket so it doesn't linger open with a live
      // ping timer. The `close` handler below detaches listeners.
      socket.close();
    }
  });

  socket.send(JSON.stringify({ type: "ready" }));

  const pingTimer = setInterval(() => {
    if (socket.readyState === socket.OPEN) socket.ping();
  }, PING_INTERVAL_MS);

  // WS → PTY (bidirectional for interactive prompts)
  socket.on("message", (raw, isBinary) => {
    if (proc.state !== "running") return;

    if (isBinary) {
      proc.pty.write((raw as Buffer).toString("utf8"));
    } else {
      try {
        const msg = JSON.parse((raw as Buffer).toString("utf8"));
        if (
          msg.type === "resize" &&
          typeof msg.cols === "number" &&
          typeof msg.rows === "number"
        ) {
          proc.pty.resize(
            Math.max(1, Math.min(500, msg.cols)),
            Math.max(1, Math.min(500, msg.rows)),
          );
        }
      } catch {
        // Ignore malformed JSON
      }
    }
  });

  // On WS close: detach listener but do NOT kill the process
  socket.on("close", () => {
    clearInterval(pingTimer);
    proc.listeners.delete(listenerId);
    proc.exitListeners.delete(listenerId);
  });
}
