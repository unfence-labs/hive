import { useEffect, useState, useCallback } from "react";
import type { Terminal as XTerm } from "@xterm/xterm";
import { PlayIcon, SquareIcon, RotateCcwIcon, CheckCircle2Icon, TerminalSquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ActivityWave } from "@/components/ui/activity-wave";
import { XtermSurface } from "@/components/XtermSurface";
import { cn } from "@/lib/utils";
import type { ScriptStatusInfo, HiveConfig } from "@/types";

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
    return <ActivityWave size="small" decorative />;
  }
  if (isSetup && status.state === "done") {
    return <CheckCircle2Icon className="size-3 text-success-foreground" />;
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
  // Only add terminal tab when hive.json exists (has scripts)
  if (tabs.length > 0) {
    tabs.push({ key: "terminal", label: "Terminal", isSetup: false, isTerminal: true });
  }
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

  // Incremented on re-run to force the terminal surface to reconnect.
  const [runGeneration, setRunGeneration] = useState(0);

  const shouldShowTerminal = currentStatus.state !== "idle";
  const actionLabel = isSetupTab ? "Run setup" : isTerminalTab ? "Start terminal" : "Run";
  const idleDescription = isSetupTab
    ? "Install dependencies"
    : isTerminalTab
      ? "Open an interactive shell"
      : "Start this script";

  // Bridge the surface terminal to the script's PTY output. Returning the
  // disconnect callback lets XtermSurface tear the WS down on reconnect/unmount.
  const connect = useCallback(
    (term: XTerm) => {
      onConnectOutput(effectiveTab, term);
      return onDisconnectOutput;
    },
    [effectiveTab, onConnectOutput, onDisconnectOutput],
  );

  const handleAction = async () => {
    if (currentStatus.state === "running") {
      if (isTerminalTab) {
        onStopTerminal();
      } else {
        onStop(effectiveTab);
      }
    } else {
      if (isTerminalTab) {
        onStartTerminal();
      } else {
        await onStart(effectiveTab);
      }
      setRunGeneration((g) => g + 1);
    }
  };

  const renderTabButton = (tab: TabInfo) => {
    const tabStatus: ScriptStatusInfo = status[tab.key] ?? { state: "idle" };
    const isActive = effectiveTab === tab.key;

    return (
      <button
        key={tab.key}
        type="button"
        aria-label={tab.label}
        title={tab.label}
        className={cn(
          "flex h-full shrink-0 items-center gap-1.5 whitespace-nowrap text-xs uppercase tracking-wide transition-colors",
          isActive ? "font-semibold text-foreground" : "font-normal text-muted-foreground hover:text-foreground",
        )}
        onClick={() => setActiveTab(tab.key)}
      >
        {tab.isTerminal ? (
          <>
            {tabStatus.state === "running" && <ActivityWave size="small" decorative />}
            <span>T1</span>
          </>
        ) : (
          <>
            <StatusIndicator status={tabStatus} isSetup={tab.isSetup} />
            <span className="block max-w-28 truncate">{tab.label}</span>
          </>
        )}
      </button>
    );
  };

  if (tabs.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-9 items-center border-t border-border/50 px-3">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Scripts</span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
          <p className="text-xs">
            Add a <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">hive.json</code> to your repo to define setup &amp; run scripts.
          </p>
          <pre className="mt-1 w-full max-w-56 rounded-md bg-muted/50 px-3 py-2 text-left text-[11px] leading-relaxed">{`{
  "scripts": {
    "setup": "npm install",
    "run": {
      "dev": "npm run dev"
    }
  }
}`}</pre>
        </div>
      </div>
    );
  }

  const terminalTab = tabs.find((tab) => tab.isTerminal);
  const scriptTabs = tabs.filter((tab) => !tab.isTerminal);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Tab bar */}
      <div className="flex h-9 min-w-0 items-center border-t border-border/50">
        <div className="min-w-0 flex-1 self-stretch overflow-x-auto overflow-y-hidden">
          <div className="flex h-full w-max min-w-full items-center gap-3 px-3">
            {scriptTabs.map(renderTabButton)}
          </div>
        </div>

        {/* Action button */}
        <div className="flex h-full shrink-0 items-center gap-3 px-3">
          <div className="h-4 w-px bg-border/70" aria-hidden="true" />
          {terminalTab && renderTabButton(terminalTab)}
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
            <XtermSurface
              connect={connect}
              connectKey={`${effectiveTab}:${runGeneration}`}
              className="h-full w-full overflow-hidden px-3"
            />
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
