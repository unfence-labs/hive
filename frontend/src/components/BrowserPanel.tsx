import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon, MonitorIcon, RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  buildBrowserStreamUrl,
  parseBrowserStreamMessage,
} from "@/lib/browser-stream";
import type { BrowserStatusPayload } from "@/types";

const DESKTOP_VIEWPORT_WIDTH = 1280;
const DESKTOP_VIEWPORT_HEIGHT = 720;
const CONNECTION_RELEASE_DELAY_MS = 2_000;

interface BrowserStreamSnapshot {
  frameSrc: string | null;
  frameReceivedAt: number;
  closedAt: number;
  connectionError: boolean;
  streamOpen: boolean;
  error?: string;
}

const emptySnapshot: BrowserStreamSnapshot = {
  frameSrc: null,
  frameReceivedAt: 0,
  closedAt: 0,
  connectionError: false,
  streamOpen: false,
};

type BrowserStreamSubscriber = (snapshot: BrowserStreamSnapshot) => void;

class BrowserStreamConnection {
  private ws: WebSocket | null = null;
  private objectUrl: string | null = null;
  private lastSentViewport: { width: number; height: number } | null = null;
  private snapshot: BrowserStreamSnapshot = emptySnapshot;
  private readonly subscribers = new Set<BrowserStreamSubscriber>();
  releaseTimer: number | null = null;

  constructor(private readonly streamUrl: string) {
    this.connect();
  }

  subscribe(subscriber: BrowserStreamSubscriber): () => void {
    this.subscribers.add(subscriber);
    subscriber(this.snapshot);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  reconnect(): void {
    this.connect();
  }

  ensureConnected(): void {
    if (
      !this.ws ||
      this.ws.readyState === WebSocket.CLOSED ||
      this.ws.readyState === WebSocket.CLOSING
    ) {
      this.connect();
    }
  }

  hasSubscribers(): boolean {
    return this.subscribers.size > 0;
  }

  close(): void {
    if (this.releaseTimer !== null) {
      window.clearTimeout(this.releaseTimer);
      this.releaseTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.lastSentViewport = null;
    this.setSnapshot(emptySnapshot);
  }

  private connect(): void {
    const previous = this.ws;
    this.ws = null;
    previous?.close();
    this.lastSentViewport = null;
    this.setSnapshot({ ...this.snapshot, connectionError: false, streamOpen: false, error: undefined });

    const ws = new WebSocket(this.streamUrl);
    this.ws = ws;
    ws.binaryType = "blob";

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.setSnapshot({
        ...this.snapshot,
        closedAt: 0,
        streamOpen: true,
        connectionError: false,
        error: undefined,
      });
      this.sendViewportResize();
    };

    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      if (event.data instanceof Blob) {
        this.setFrame(URL.createObjectURL(event.data));
        return;
      }

      if (typeof event.data !== "string") return;
      const parsed = parseBrowserStreamMessage(event.data);
      if (!parsed) return;

      if ("error" in parsed && parsed.error) {
        this.setSnapshot({ ...this.snapshot, error: parsed.error, connectionError: true });
      }
      if ("src" in parsed && parsed.src) {
        this.setFrame(parsed.src);
      }
    };

    ws.onerror = () => {
      if (this.ws !== ws) return;
      this.setSnapshot({
        ...this.snapshot,
        streamOpen: false,
        connectionError: true,
        error: "Browser stream unavailable",
      });
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.setSnapshot({
        ...this.snapshot,
        frameSrc: null,
        frameReceivedAt: 0,
        closedAt: Date.now(),
        streamOpen: false,
      });
    };
  }

  private setFrame(frameSrc: string): void {
    if (this.objectUrl && this.objectUrl !== frameSrc) {
      URL.revokeObjectURL(this.objectUrl);
    }
    this.objectUrl = frameSrc.startsWith("blob:") ? frameSrc : null;
    this.setSnapshot({
      ...this.snapshot,
      frameSrc,
      frameReceivedAt: Date.now(),
      closedAt: 0,
      streamOpen: true,
      connectionError: false,
      error: undefined,
    });
  }

  private sendViewportResize(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const width = DESKTOP_VIEWPORT_WIDTH;
    const height = DESKTOP_VIEWPORT_HEIGHT;
    const last = this.lastSentViewport;
    if (last?.width === width && last.height === height) return;
    this.lastSentViewport = { width, height };
    ws.send(JSON.stringify({ type: "viewport_resize", width, height }));
  }

  private setSnapshot(snapshot: BrowserStreamSnapshot): void {
    this.snapshot = snapshot;
    for (const subscriber of this.subscribers) {
      subscriber(snapshot);
    }
  }
}

const browserStreamConnections = new Map<string, BrowserStreamConnection>();

function retainBrowserStreamConnection(streamUrl: string): BrowserStreamConnection {
  const existing = browserStreamConnections.get(streamUrl);
  if (existing) {
    if (existing.releaseTimer !== null) {
      window.clearTimeout(existing.releaseTimer);
      existing.releaseTimer = null;
    }
    existing.ensureConnected();
    return existing;
  }

  const created = new BrowserStreamConnection(streamUrl);
  browserStreamConnections.set(streamUrl, created);
  return created;
}

function releaseBrowserStreamConnection(streamUrl: string, connection: BrowserStreamConnection): void {
  if (connection.releaseTimer !== null) {
    window.clearTimeout(connection.releaseTimer);
  }
  connection.releaseTimer = window.setTimeout(() => {
    if (browserStreamConnections.get(streamUrl) !== connection) return;
    if (connection.hasSubscribers()) return;
    browserStreamConnections.delete(streamUrl);
    connection.close();
  }, CONNECTION_RELEASE_DELAY_MS);
}

export function __clearBrowserStreamConnectionsForTests(): void {
  for (const connection of browserStreamConnections.values()) {
    connection.close();
  }
  browserStreamConnections.clear();
}

interface BrowserPanelProps {
  status?: BrowserStatusPayload;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

export function BrowserPanel({ status, collapsed = false, onToggleCollapsed }: BrowserPanelProps) {
  const connectionRef = useRef<BrowserStreamConnection | null>(null);

  const [streamSnapshot, setStreamSnapshot] = useState<BrowserStreamSnapshot>(emptySnapshot);
  const [displayFrameSrc, setDisplayFrameSrc] = useState<string | null>(null);
  const [statusStoppedAt, setStatusStoppedAt] = useState(0);
  const [statusStartedAt, setStatusStartedAt] = useState(0);

  const streamUrl = useMemo(
    () => status?.streamPath && status.streaming !== false
      ? buildBrowserStreamUrl(status.streamPath)
      : null,
    [status?.streamPath, status?.streaming],
  );

  useEffect(() => {
    if (!streamUrl) {
      connectionRef.current = null;
      setStreamSnapshot(emptySnapshot);
      setDisplayFrameSrc(null);
      return undefined;
    }

    const connection = retainBrowserStreamConnection(streamUrl);
    connectionRef.current = connection;
    const unsubscribe = connection.subscribe(setStreamSnapshot);

    return () => {
      unsubscribe();
      if (connectionRef.current === connection) {
        connectionRef.current = null;
      }
      releaseBrowserStreamConnection(streamUrl, connection);
    };
  }, [streamUrl]);

  useEffect(() => {
    if (!streamUrl) {
      setDisplayFrameSrc(null);
      return;
    }
    if (!streamSnapshot.frameSrc && streamSnapshot.closedAt > 0) {
      setDisplayFrameSrc(null);
      return;
    }
    if (streamSnapshot.frameSrc) {
      setDisplayFrameSrc(streamSnapshot.frameSrc);
    }
  }, [streamSnapshot.closedAt, streamSnapshot.frameSrc, streamUrl]);

  useEffect(() => {
    if (status?.streaming === false) {
      setStatusStoppedAt(Date.now());
    } else if (status?.streaming === true) {
      setStatusStoppedAt(0);
      setStatusStartedAt(Date.now());
      connectionRef.current?.ensureConnected();
    }
  }, [status?.streaming, status?.updatedAt]);

  useEffect(() => {
    if (
      status?.streaming === false &&
      statusStoppedAt > 0 &&
      streamSnapshot.frameReceivedAt <= statusStoppedAt
    ) {
      setDisplayFrameSrc(null);
    }
  }, [status?.streaming, statusStoppedAt, streamSnapshot.frameReceivedAt]);

  const isActive = Boolean(status);
  const localFrameAfterStop = statusStoppedAt > 0 && streamSnapshot.frameReceivedAt > statusStoppedAt;
  const localStreamAllowed = status?.streaming !== false || localFrameAfterStop;
  const statusStreamingActive = Boolean(status?.streaming) && (
    streamSnapshot.closedAt === 0 ||
    statusStartedAt > streamSnapshot.closedAt
  );
  const hasLiveStream = localStreamAllowed && (
    Boolean(streamUrl && streamSnapshot.streamOpen) ||
    Boolean(streamSnapshot.frameSrc)
  );
  const isStreaming = isActive && !streamSnapshot.connectionError && (statusStreamingActive || hasLiveStream);
  const statusLabel = isStreaming ? "streaming" : "not streaming";
  const error = status?.error ?? streamSnapshot.error;

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
        <div className="flex h-9 shrink-0 items-center gap-3 border-t border-border/50 px-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <MonitorIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="text-xs uppercase tracking-wide text-foreground">Browser</span>
          </div>
          <span className="flex items-center gap-1 rounded-full bg-sidebar-accent/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            <span className={isStreaming ? "size-1.5 rounded-full bg-emerald-400" : "size-1.5 rounded-full bg-muted-foreground/50"} />
            {statusLabel}
          </span>

          <div className="ml-auto" />

          {isActive && !collapsed && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => connectionRef.current?.reconnect()}
                  aria-label="Reconnect browser stream"
                >
                  <RotateCcwIcon className="size-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reconnect</TooltipContent>
            </Tooltip>
          )}

          {isActive && onToggleCollapsed && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={onToggleCollapsed}
                  aria-label={collapsed ? "Expand browser panel" : "Collapse browser panel"}
                >
                  {collapsed ? <ChevronUpIcon className="size-3" /> : <ChevronDownIcon className="size-3" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{collapsed ? "Expand" : "Collapse"}</TooltipContent>
            </Tooltip>
          )}
        </div>

        {isActive && !collapsed && (
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-sidebar">
            {displayFrameSrc ? (
              <img
                src={displayFrameSrc}
                alt="Agent browser"
                className="h-full w-full object-contain"
                draggable={false}
              />
            ) : (
              <div className="px-4 text-center text-xs text-muted-foreground">
                {error ?? (status?.state === "error" ? "Browser stream unavailable" : "Waiting for browser stream")}
              </div>
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
