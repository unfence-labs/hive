import { useEffect, useRef, useCallback, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import type { WsMessage } from "@/types";

export function useAgentStream(agentId: string | undefined, terminal: Terminal | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);
  }, []);

  useEffect(() => {
    if (!agentId || !terminal) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/agents/${agentId}/stream`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);

    ws.onmessage = (event) => {
      try {
        const msg: WsMessage = JSON.parse(event.data);
        if (msg.type === "stdout" || msg.type === "stderr") {
          terminal.write(msg.data ?? "");
        } else if (msg.type === "exit") {
          terminal.writeln(`\r\n[Process exited with code ${msg.code}]`);
        }
      } catch {
        terminal.write(event.data);
      }
    };

    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    return () => {
      ws.close();
      wsRef.current = null;
      setConnected(false);
    };
  }, [agentId, terminal]);

  return { connected, disconnect };
}
