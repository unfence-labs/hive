import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { PlayIcon, SquareIcon, RotateCcwIcon, CheckCircle2Icon, TerminalSquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { WaveIndicator } from "@/components/WaveIndicator";
import { cn } from "@/lib/utils";
import type { ScriptStatusInfo, HiveConfig } from "@/types";
import "@xterm/xterm/css/xterm.css";

interface ScriptPanelProps {
  config: HiveConfig | null;
  status: Record<string, ScriptStatusInfo>;
  onStart: (type: string) => Promise<void> | void;
  onStop: (type: string) => Promise<void> | void;
  onStartTerminal: () => void;
  onStopTerminal: () => void;
  onConnectOutput: (type: string, term: XTerm) => void;
  onDisconnectOutput: () => void;
}

interface TabInfo {
  key: string;
  label: string;
  isSetup: boolean;
  isTerminal: boolean;
}

function StatusIndicator({ status, isSetup }: { status: ScriptStatusInfo; isSetup: boolean }) {
  if (status.state === "running") {
    return <WaveIndicator />;
  }
  if (isSetup && status.state === "done") {
    return <CheckCircle2Icon className="size-3 text-green-400" />;
  }
  return null;
}

function buildTabs(config: HiveConfig | null): TabInfo[] {
  const tabs: TabInfo[] = [];
  if (config?.scripts?.setup) {
    tabs.push({ key: "setup", label: "Setup", isSetup: true, isTerminal: false });
  }
  if (config?.scripts?.run) {
    for (const name of Object.keys(config.scripts.run)) {
      tabs.push({ key: name, label: name.charAt(0).toUpperCase() + name.slice(1), isSetup: false, isTerminal: false });
    }
  }
  // Always add terminal tab
  tabs.push({ key: "terminal", label: "Terminal", isSetup: false, isTerminal: true });
  return tabs;
}

export default function ScriptPanel({
  config,
  status,
  onStart,
  onStop,
  onStartTerminal,
  onStopTerminal,
  onConnectOutput,
  onDisconnectOutput,
}: ScriptPanelProps) {
  const tabs = buildTabs(config);

  const [activeTab, setActiveTab] = useState<string>(tabs[0]?.key ?? "terminal");

  // When config loads and tabs change, reset to first tab (e.g. "setup") if current tab is just the default "terminal"
  const firstTabKey = tabs[0]?.key ?? "terminal";
  useEffect(() => {
    if (firstTabKey !== "terminal") {
      setActiveTab((prev) => prev === "terminal" ? firstTabKey : prev);
    }
  }, [firstTabKey]);

  // If the active tab no longer exists in config, fall back to first
  const effectiveTab = tabs.find((t) => t.key === activeTab)?.key ?? tabs[0]?.key ?? "terminal";
  const tabInfo = tabs.find((t) => t.key === effectiveTab);
  const isSetupTab = tabInfo?.isSetup ?? false;
  const isTerminalTab = tabInfo?.isTerminal ?? false;
  const currentStatus: ScriptStatusInfo = status[effectiveTab] ?? { state: "idle" };

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const connectedTabRef = useRef<string | null>(null);

  // Incremented on re-run to force the terminal init effect to re-fire
  const [runGeneration, setRunGeneration] = useState(0);

  const shouldShowTerminal = currentStatus.state !== "idle";
  const actionLabel = isSetupTab ? "Run setup" : isTerminalTab ? "Start terminal" : "Run";
  const idleDescription = isSetupTab
    ? "Install dependencies"
    : isTerminalTab
      ? "Open an interactive shell"
      : "Start this script";

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
      const timer = setTimeout(() => initTerminal(), 50);
      return () => clearTimeout(timer);
    }
    destroyTerminal();
    return undefined;
  }, [shouldShowTerminal, runGeneration, initTerminal, destroyTerminal]);

  // Reconnect when tab changes
  useEffect(() => {
    if (shouldShowTerminal && termRef.current && connectedTabRef.current !== effectiveTab) {
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
      if (isTerminalTab) {
        onStopTerminal();
      } else {
        onStop(effectiveTab);
      }
    } else {
      destroyTerminal();
      if (isTerminalTab) {
        onStartTerminal();
      } else {
        await onStart(effectiveTab);
      }
      setRunGeneration((g) => g + 1);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Tab bar */}
      <div className="flex h-9 items-center gap-3 border-t border-border/50 px-3">
        {tabs.map((tab) => {
          const tabStatus: ScriptStatusInfo = status[tab.key] ?? { state: "idle" };
          return (
            <button
              key={tab.key}
              type="button"
              aria-label={tab.label}
              className={cn(
                "flex items-center gap-1.5 text-xs uppercase tracking-wide transition-colors",
                effectiveTab === tab.key
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.isTerminal ? (
                <>
                  {tabStatus.state === "running" && <WaveIndicator />}
                  <TerminalSquareIcon className="size-3" />
                </>
              ) : (
                <>
                  <StatusIndicator status={tabStatus} isSetup={tab.isSetup} />
                  {tab.label}
                </>
              )}
            </button>
          );
        })}

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
            <Button variant="ghost" size="icon-xs" onClick={handleAction} title={actionLabel}>
              <PlayIcon className="size-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {shouldShowTerminal ? (
          <>
            <div ref={containerRef} className="h-full w-full px-3" style={{ backgroundColor: "#09090f" }} />
            {/* Port badge */}
            {!isSetupTab && !isTerminalTab && config?.port && currentStatus.state === "running" && (
              <div className="absolute bottom-2 right-2">
                <Badge variant="secondary" className="text-[10px]">
                  Port {config.port}
                </Badge>
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            {isTerminalTab ? (
              <TerminalSquareIcon className="size-8 text-muted-foreground/30" />
            ) : (
              <PlayIcon className="size-8 text-muted-foreground/30" />
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleAction}
            >
              {isTerminalTab ? (
                <TerminalSquareIcon className="size-3" />
              ) : (
                <PlayIcon className="size-3" />
              )}
              {actionLabel}
            </Button>
            <p className="text-xs text-muted-foreground/60">
              {idleDescription}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
