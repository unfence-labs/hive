import { useCallback, useState } from "react";
import type { Terminal as XTerm } from "@xterm/xterm";
import { TerminalSquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { XtermSurface } from "@/components/XtermSurface";
import { api } from "@/hooks/useApi";
import { buildWsUrl } from "@/lib/ws-url";
import { connectPtyTerminal } from "@/lib/pty-terminal";

interface TerminalPaneProps {
  wsId: string;
  sessionId: string;
}

type PaneState =
  | { kind: "connecting" }
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "exited"; code: number };

/**
 * Full-pane interactive shell for a terminal-kind session. On mount it attaches
 * to the workspace's PTY socket (keyed by `sessionId`): when a PTY is alive the
 * server replays its scrollback and the pane shows it live; otherwise the server
 * reports no process and the pane offers a start button. The PTY outlives the
 * pane — switching away only closes the socket, never the shell.
 *
 * State starts as `connecting` (no overlay) so revisiting a live terminal shows
 * its output without a "Start" flash; it resolves to `running`/`idle`/`exited`
 * from the first control frame, or falls back to `idle` if the socket dies.
 */
export function TerminalPane({ wsId, sessionId }: TerminalPaneProps) {
  const [state, setState] = useState<PaneState>({ kind: "connecting" });
  // Bumped to force XtermSurface to drop its terminal and reconnect after a
  // (re)start, so the new PTY's output replays from a clean surface.
  const [connectGeneration, setConnectGeneration] = useState(0);

  const connect = useCallback(
    (term: XTerm) => {
      const url = buildWsUrl(`/ws/terminal/${wsId}`, { sessionId });
      return connectPtyTerminal(term, url, {
        onControl: (msg) => {
          if (msg.type === "ready") setState({ kind: "running" });
          else if (msg.type === "error") setState({ kind: "idle" });
        },
        onExit: (code) => setState({ kind: "exited", code }),
        // Socket died unsolicited — no PTY on connect, or a mid-session drop
        // (network/backend restart). Resolve anything that isn't a clean exit to
        // idle so the start button reappears; re-POSTing reconnects to a PTY that
        // is still alive (409 is swallowed). A clean exit keeps its code.
        onClose: () =>
          setState((prev) => (prev.kind === "exited" ? prev : { kind: "idle" })),
      });
    },
    [wsId, sessionId],
  );

  const start = useCallback(async () => {
    setState({ kind: "connecting" });
    try {
      await api.post(`/api/workspaces/${wsId}/terminal-tabs/${sessionId}/start`);
    } catch {
      // Already running (409) is fine — reconnect picks up the live PTY.
    }
    setConnectGeneration((g) => g + 1);
  }, [wsId, sessionId]);

  const showOverlay = state.kind === "idle" || state.kind === "exited";

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <XtermSurface
        connect={connect}
        connectKey={`${sessionId}:${connectGeneration}`}
        className="h-full w-full overflow-hidden px-3"
      />
      {showOverlay && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-sidebar">
          <TerminalSquareIcon className="size-8 text-muted-foreground/30" />
          {state.kind === "exited" && (
            <p className="text-xs text-muted-foreground/60">
              Terminal exited (code {state.code})
            </p>
          )}
          <Button variant="outline" size="sm" onClick={start}>
            <TerminalSquareIcon className="size-3" />
            {state.kind === "exited" ? "Restart" : "Start terminal"}
          </Button>
          <p className="text-xs text-muted-foreground/60">Open an interactive shell</p>
        </div>
      )}
    </div>
  );
}
