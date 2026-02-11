import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useAgentStream } from "@/hooks/useAgentStream";

interface AgentTerminalProps {
  agentId: string | undefined;
  prompt?: string;
}

export default function AgentTerminal({ agentId, prompt }: AgentTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [terminal, setTerminal] = useState<Terminal | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: false,
      fontSize: 13,
      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
      theme: {
        background: "#1a1a1a",
        foreground: "#e0e0e0",
      },
      convertEol: true,
      disableStdin: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    const observer = new ResizeObserver(() => fitAddon.fit());
    observer.observe(containerRef.current);

    setTerminal(term);

    return () => {
      observer.disconnect();
      term.dispose();
      setTerminal(null);
    };
  }, []);

  useAgentStream(agentId, terminal);

  return (
    <div className="rounded-lg border bg-card">
      {prompt && (
        <div className="border-b px-4 py-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Prompt:</span> {prompt}
        </div>
      )}
      <div ref={containerRef} className="h-80" />
    </div>
  );
}
