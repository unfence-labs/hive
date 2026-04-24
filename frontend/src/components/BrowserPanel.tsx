import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon, Maximize2Icon, MonitorIcon, PauseIcon, PlayIcon, RotateCcwIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  buildBrowserStreamUrl,
  parseBrowserStreamMessage,
} from "@/lib/browser-stream";
import type { BrowserStatusPayload } from "@/types";

const VIEWPORT_RESIZE_DEBOUNCE_MS = 250;
const MIN_VIEWPORT_WIDTH = 160;
const MIN_VIEWPORT_HEIGHT = 120;

interface BrowserPanelProps {
  status?: BrowserStatusPayload;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

export function BrowserPanel({ status, collapsed = false, onToggleCollapsed }: BrowserPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const pausedRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  const lastSentViewportRef = useRef<{ width: number; height: number } | null>(null);

  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState(false);
  const [paused, setPaused] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [error, setError] = useState(status?.error);

  pausedRef.current = paused;

  const streamUrl = useMemo(
    () => !collapsed && status?.streamPath ? buildBrowserStreamUrl(status.streamPath) : null,
    [collapsed, status?.streamPath],
  );

  useEffect(() => {
    setError(status?.error);
  }, [status?.error]);

  const sendViewportResize = useCallback(() => {
    const element = containerRef.current;
    const ws = wsRef.current;
    if (!element || !ws || ws.readyState !== WebSocket.OPEN) return;

    const rect = element.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (width < MIN_VIEWPORT_WIDTH || height < MIN_VIEWPORT_HEIGHT) return;

    const last = lastSentViewportRef.current;
    if (last?.width === width && last.height === height) return;
    lastSentViewportRef.current = { width, height };
    ws.send(JSON.stringify({ type: "viewport_resize", width, height }));
  }, []);

  useEffect(() => {
    if (!streamUrl) {
      setConnectionError(false);
      setFrameSrc(null);
      return undefined;
    }
    lastSentViewportRef.current = null;
    setConnectionError(false);
    setError(undefined);

    const ws = new WebSocket(streamUrl);
    wsRef.current = ws;
    ws.binaryType = "blob";

    ws.onopen = () => {
      sendViewportResize();
    };

    ws.onmessage = (event) => {
      if (event.data instanceof Blob) {
        if (pausedRef.current) return;
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        const objectUrl = URL.createObjectURL(event.data);
        objectUrlRef.current = objectUrl;
        setFrameSrc(objectUrl);
        return;
      }

      if (typeof event.data !== "string") return;
      const parsed = parseBrowserStreamMessage(event.data);
      if (!parsed) return;

      if ("error" in parsed && parsed.error) {
        setError(parsed.error);
        setConnectionError(true);
      }
      if ("src" in parsed && parsed.src && !pausedRef.current) {
        setFrameSrc(parsed.src);
      }
    };

    ws.onerror = () => {
      setConnectionError(true);
      setError("Browser stream unavailable");
    };

    return () => {
      if (wsRef.current === ws) wsRef.current = null;
      ws.close();
    };
  }, [streamUrl, retryNonce, sendViewportResize]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;

    const scheduleResize = () => {
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
      }
      resizeTimerRef.current = window.setTimeout(() => {
        resizeTimerRef.current = null;
        sendViewportResize();
      }, VIEWPORT_RESIZE_DEBOUNCE_MS);
    };

    if (typeof ResizeObserver === "undefined") {
      scheduleResize();
      return () => {
        if (resizeTimerRef.current !== null) {
          window.clearTimeout(resizeTimerRef.current);
          resizeTimerRef.current = null;
        }
      };
    }

    const observer = new ResizeObserver(scheduleResize);
    observer.observe(element);
    scheduleResize();

    return () => {
      observer.disconnect();
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
    };
  }, [sendViewportResize, streamUrl, retryNonce]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  const handleFullscreen = useCallback(() => {
    void containerRef.current?.requestFullscreen?.();
  }, []);

  const isActive = Boolean(status);
  const isError = isActive && (status?.state === "error" || connectionError);
  const statusBadge = !isActive ? "Idle" : isError ? "Error" : "Live";

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-col bg-background">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/50 px-3">
          <MonitorIcon className="size-3.5 text-muted-foreground" />
          <span className="text-xs font-medium uppercase tracking-wide text-foreground">Browser</span>
          <Badge
            variant={isError ? "destructive" : "secondary"}
            className="px-1.5 py-0 text-[10px]"
          >
            {statusBadge}
          </Badge>

          <div className="ml-auto" />

          {isActive && !collapsed && (
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setPaused((value) => !value)}
                    aria-label={paused ? "Resume browser stream" : "Pause browser stream"}
                  >
                    {paused ? <PlayIcon className="size-3" /> : <PauseIcon className="size-3" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{paused ? "Resume" : "Pause"}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setRetryNonce((value) => value + 1)}
                    aria-label="Reconnect browser stream"
                  >
                    <RotateCcwIcon className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Reconnect</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={handleFullscreen}
                    aria-label="Fullscreen browser stream"
                  >
                    <Maximize2Icon className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Fullscreen</TooltipContent>
              </Tooltip>
            </div>
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
          <div ref={containerRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black">
            {frameSrc ? (
              <img
                src={frameSrc}
                alt="Agent browser"
                className="h-full w-full object-fill"
                draggable={false}
              />
            ) : (
              <div className="px-4 text-center text-xs text-zinc-400">
                {error ?? (status?.state === "error" ? "Browser stream unavailable" : "Waiting for browser stream")}
              </div>
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
