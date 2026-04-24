import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2Icon, PauseIcon, PlayIcon, RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  buildBrowserStreamUrl,
  parseBrowserStreamMessage,
  type BrowserStreamConnectionStatus,
} from "@/lib/browser-stream";
import { cn } from "@/lib/utils";
import type { BrowserStatusPayload } from "@/types";

interface BrowserPanelProps {
  status: BrowserStatusPayload;
}

function connectionLabel(status: BrowserStreamConnectionStatus): string {
  switch (status) {
    case "connecting":
      return "Connecting";
    case "connected":
      return "Live";
    case "error":
      return "Error";
    case "disconnected":
      return "Disconnected";
  }
}

export function BrowserPanel({ status }: BrowserPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const pausedRef = useRef(false);

  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<BrowserStreamConnectionStatus>("connecting");
  const [paused, setPaused] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [url, setUrl] = useState(status.url);
  const [title, setTitle] = useState(status.title);
  const [error, setError] = useState(status.error);

  pausedRef.current = paused;

  const streamUrl = useMemo(
    () => status.streamPath ? buildBrowserStreamUrl(status.streamPath) : null,
    [status.streamPath],
  );

  useEffect(() => {
    setUrl(status.url);
    setTitle(status.title);
    setError(status.error);
  }, [status.url, status.title, status.error]);

  useEffect(() => {
    if (!streamUrl) return undefined;
    setConnectionStatus("connecting");
    setError(undefined);

    const ws = new WebSocket(streamUrl);
    ws.binaryType = "blob";

    ws.onopen = () => {
      setConnectionStatus("connected");
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
        setConnectionStatus("error");
      }
      if ("url" in parsed && parsed.url) setUrl(parsed.url);
      if ("title" in parsed && parsed.title) setTitle(parsed.title);
      if ("src" in parsed && parsed.src && !pausedRef.current) {
        setFrameSrc(parsed.src);
      }
    };

    ws.onerror = () => {
      setConnectionStatus("error");
      setError("Browser stream unavailable");
    };

    ws.onclose = () => {
      setConnectionStatus((current) => current === "error" ? current : "disconnected");
    };

    return () => {
      ws.close();
    };
  }, [streamUrl, retryNonce]);

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

  const displayUrl = url ?? title ?? "Browser";
  const isLive = connectionStatus === "connected" && !paused;

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-col bg-background">
        <div ref={containerRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black">
          {frameSrc ? (
            <img
              src={frameSrc}
              alt="Agent browser"
              className="h-full w-full object-contain"
              draggable={false}
            />
          ) : (
            <div className="px-4 text-center text-xs text-zinc-400">
              {error ?? (status.state === "error" ? "Browser stream unavailable" : "Waiting for browser stream")}
            </div>
          )}

          <div className="absolute left-3 top-3 flex min-w-0 max-w-[calc(100%-7rem)] items-center gap-2 rounded-md border border-white/10 bg-black/70 px-2 py-1 text-xs text-white shadow-sm backdrop-blur">
            <span
              className={cn(
                "size-1.5 rounded-full",
                isLive ? "bg-emerald-400" : connectionStatus === "error" ? "bg-red-400" : "bg-zinc-400",
              )}
            />
            <span className="shrink-0 text-white/70">{connectionLabel(connectionStatus)}</span>
            <span className="truncate text-white/90">{displayUrl}</span>
          </div>

          <div className="absolute right-3 top-3 flex items-center gap-1 rounded-md border border-white/10 bg-black/70 p-1 shadow-sm backdrop-blur">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="text-white/80 hover:bg-white/10 hover:text-white"
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
                  className="text-white/80 hover:bg-white/10 hover:text-white"
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
                  className="text-white/80 hover:bg-white/10 hover:text-white"
                  onClick={handleFullscreen}
                  aria-label="Fullscreen browser stream"
                >
                  <Maximize2Icon className="size-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Fullscreen</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
