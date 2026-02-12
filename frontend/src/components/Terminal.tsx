import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
  workspaceId: string;
}

const encoder = new TextEncoder();

export default function Terminal({ workspaceId }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [overlay, setOverlay] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let disposed = false;
    setOverlay(null);

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: { background: "#1e1e1e" },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(el);
    fitAddon.fit();
    term.focus();

    // WebSocket
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsHost =
      import.meta.env.VITE_WS_URL || `${protocol}//${window.location.host}`;
    const authToken = (import.meta.env.VITE_HIVE_AUTH_TOKEN as string | undefined)?.trim();
    const query = authToken ? `?token=${encodeURIComponent(authToken)}` : "";
    const ws = new WebSocket(
      `${wsHost}/ws/terminal/${workspaceId}${query}`,
    );
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      if (disposed) return;
      ws.send(
        JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }),
      );
    };

    ws.onmessage = (event) => {
      if (disposed) return;
      if (event.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(event.data));
      } else {
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.type === "exit") {
            setOverlay(`Session ended (exit code: ${msg.code})`);
          } else if (msg.type === "error") {
            setOverlay(msg.message ?? "Connection error");
          }
        } catch {
          // ignore
        }
      }
    };

    ws.onerror = () => {
      if (!disposed) setOverlay("Connection failed");
    };
    ws.onclose = () => {
      if (!disposed) setOverlay((prev) => prev ?? "Disconnected");
    };

    // Terminal input → WS (binary)
    const inputDisposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(encoder.encode(data));
      }
    });

    // Resize → WS + PTY
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(el);

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      inputDisposable.dispose();
      resizeDisposable.dispose();
      ws.close();
      term.dispose();
    };
  }, [workspaceId]);

  return (
    <div className="relative h-full w-full bg-[#1e1e1e]">
      <div ref={containerRef} className="h-full w-full" />
      {overlay && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="rounded-lg border border-border bg-card p-6 text-center shadow-lg">
            <p className="text-sm text-muted-foreground">{overlay}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
            >
              Reconnect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
