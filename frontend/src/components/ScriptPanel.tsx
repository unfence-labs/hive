import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { PlayIcon, SquareIcon, RotateCcwIcon, CheckCircle2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { WaveIndicator } from "@/components/WaveIndicator";
import { cn } from "@/lib/utils";
import type { ScriptType, ScriptStatusInfo, HiveConfig } from "@/types";
import "@xterm/xterm/css/xterm.css";

interface ScriptPanelProps {
  config: HiveConfig | null;
  status: {
    setup: ScriptStatusInfo;
    run: ScriptStatusInfo;
  };
  onStart: (type: ScriptType) => Promise<void> | void;
  onStop: (type: ScriptType) => Promise<void> | void;
  onConnectOutput: (type: ScriptType, term: XTerm) => void;
  onDisconnectOutput: () => void;
}

function StatusIndicator({ status, type }: { status: ScriptStatusInfo; type: ScriptType }) {
  if (status.state === "running") {
    return <WaveIndicator />;
  }
  if (type === "setup" && status.state === "done") {
    return <CheckCircle2Icon className="size-3 text-green-400" />;
  }
  return null;
}

export default function ScriptPanel({
  config,
  status,
  onStart,
  onStop,
  onConnectOutput,
  onDisconnectOutput,
}: ScriptPanelProps) {
  const hasSetup = !!config?.scripts?.setup;
  const hasRun = !!config?.scripts?.run;
  const hasScripts = hasSetup || hasRun;

  // Default to the first available tab
  const defaultTab: ScriptType = hasSetup ? "setup" : "run";
  const [activeTab, setActiveTab] = useState<ScriptType>(defaultTab);

  // If the active tab's script doesn't exist, switch to the other
  const effectiveTab = (activeTab === "setup" && !hasSetup) ? "run" : (activeTab === "run" && !hasRun) ? "setup" : activeTab;
  const currentStatus = hasScripts ? status[effectiveTab] : { state: "idle" as const };

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const connectedTabRef = useRef<ScriptType | null>(null);

  // Incremented on re-run to force the terminal init effect to re-fire
  // (shouldShowTerminal stays true when going from done/error → running)
  const [runGeneration, setRunGeneration] = useState(0);

  // Create / destroy xterm when the tab changes or when status transitions to running
  const shouldShowTerminal = currentStatus.state !== "idle";

  const initTerminal = useCallback(() => {
    const el = containerRef.current;
    if (!el || termRef.current) return;

    const term = new XTerm({
      cursorBlink: false,
      fontSize: 12,
      fontFamily: '"Geist Mono", Menlo, Monaco, "Courier New", monospace',
      lineHeight: 1.3,
      theme: { background: "#09090f" },
      scrollback: 5000,
      disableStdin: false,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(el);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Connect to the script WS
    connectedTabRef.current = effectiveTab;
    onConnectOutput(effectiveTab, term);
  }, [effectiveTab, onConnectOutput]);

  const destroyTerminal = useCallback(() => {
    if (termRef.current) {
      onDisconnectOutput();
      termRef.current.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      connectedTabRef.current = null;
    }
  }, [onDisconnectOutput]);

  // Init terminal when needed (runGeneration forces re-fire on restart)
  useEffect(() => {
    if (shouldShowTerminal) {
      // Small delay to let the DOM container render
      const timer = setTimeout(() => initTerminal(), 50);
      return () => clearTimeout(timer);
    }
    destroyTerminal();
    return undefined;
  }, [shouldShowTerminal, runGeneration, initTerminal, destroyTerminal]);

  // Reconnect when tab changes
  useEffect(() => {
    if (shouldShowTerminal && termRef.current && connectedTabRef.current !== effectiveTab) {
      // Tab changed while terminal is alive — destroy and reinit
      destroyTerminal();
      const timer = setTimeout(() => initTerminal(), 50);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [effectiveTab, shouldShowTerminal, destroyTerminal, initTerminal]);

  // ResizeObserver for fitting
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      fitAddonRef.current?.fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      destroyTerminal();
    };
  }, [destroyTerminal]);

  const handleAction = async () => {
    if (currentStatus.state === "running") {
      onStop(effectiveTab);
    } else {
      // Clear terminal before re-run
      destroyTerminal();
      // Await start so the backend process exists before the WS connects
      await onStart(effectiveTab);
      // Force the terminal init effect to re-fire
      setRunGeneration((g) => g + 1);
    }
  };

  if (!hasScripts) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-9 items-center border-t border-border/50 px-3">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Scripts</span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
          <p className="text-xs">
            Add a <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">hive.json</code> to your repo to define setup &amp; run scripts.
          </p>
          <pre className="mt-1 rounded-md bg-muted/50 px-3 py-2 text-left text-[11px] leading-relaxed">{`{
  "scripts": {
    "setup": "npm install",
    "run": "npm run dev"
  }
}`}</pre>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Tab bar */}
      <div className="flex h-9 items-center gap-3 border-t border-border/50 px-3">
        {hasSetup && (
          <button
            type="button"
            className={cn(
              "flex items-center gap-1.5 text-xs uppercase tracking-wide transition-colors",
              effectiveTab === "setup"
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setActiveTab("setup")}
          >
            <StatusIndicator status={status.setup} type="setup" />
            Setup
          </button>
        )}
        {hasRun && (
          <button
            type="button"
            className={cn(
              "flex items-center gap-1.5 text-xs uppercase tracking-wide transition-colors",
              effectiveTab === "run"
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setActiveTab("run")}
          >
            <StatusIndicator status={status.run} type="run" />
            Run
          </button>
        )}

        {/* Action button */}
        <div className="ml-auto">
          {currentStatus.state === "running" ? (
            <Button variant="ghost" size="icon-xs" onClick={handleAction} title="Stop">
              <SquareIcon className="size-3 text-destructive" />
            </Button>
          ) : currentStatus.state === "done" || currentStatus.state === "error" ? (
            <Button variant="ghost" size="icon-xs" onClick={handleAction} title="Re-run">
              <RotateCcwIcon className="size-3" />
            </Button>
          ) : (
            <Button variant="ghost" size="icon-xs" onClick={handleAction} title={effectiveTab === "setup" ? "Run setup" : "Run"}>
              <PlayIcon className="size-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {shouldShowTerminal ? (
          <>
            <div ref={containerRef} className="h-full w-full bg-background" />
            {/* Port badge */}
            {effectiveTab === "run" && config.port && currentStatus.state === "running" && (
              <div className="absolute bottom-2 right-2">
                <Badge variant="secondary" className="text-[10px]">
                  Port {config.port}
                </Badge>
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <PlayIcon className="size-8 text-muted-foreground/30" />
            <Button
              variant="outline"
              size="sm"
              onClick={handleAction}
            >
              <PlayIcon className="size-3" />
              {effectiveTab === "setup" ? "Run setup" : "Run workspace"}
            </Button>
            <p className="text-xs text-muted-foreground/60">
              {effectiveTab === "setup" ? "Install dependencies" : "Test your changes here."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
