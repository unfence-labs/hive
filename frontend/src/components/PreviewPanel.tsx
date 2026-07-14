import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ExternalLinkIcon,
  GlobeIcon,
  MonitorIcon,
  PencilLineIcon,
  RotateCwIcon,
  SmartphoneIcon,
  TabletIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { openExternal } from "@/lib/open-external";
import { usePreview, previewProxyOrigin } from "@/hooks/usePreview";
import type { UiAnnotation } from "@/types";

export interface PreviewPanelHandle {
  /** Remove all annotation pins inside the previewed page. */
  clearAnnotations: () => void;
  /** Remove a single annotation pin inside the previewed page. */
  removeAnnotation: (id: number) => void;
  /** Scroll a pending annotation into view and open its note editor. */
  focusAnnotation: (id: number) => void;
  /** Navigate to a sent annotation's page if needed and flash its location. */
  flashLocation: (annotation: UiAnnotation) => void;
}

interface PreviewPanelProps {
  wsId: string;
  annotationCount: number;
  /** Mirrors the annotator's list into the host (chips + send flow). */
  onAnnotationsChange: (annotations: UiAnnotation[]) => void;
}

type DeviceWidth = "desktop" | "tablet" | "mobile";

const DEVICE_WIDTHS: Record<DeviceWidth, number | null> = {
  desktop: null,
  tablet: 768,
  mobile: 390,
};

/**
 * In-app browser for the workspace dev server. Renders the app through the
 * backend preview proxy (which injects the annotation overlay) and bridges
 * annotate mode + annotations between the iframe and the composer.
 */
export const PreviewPanel = forwardRef<PreviewPanelHandle, PreviewPanelProps>(
  function PreviewPanel({ wsId, annotationCount, onAnnotationsChange }, ref) {
    const { status, start, isStarting, startError } = usePreview(wsId);
    const proxy = status?.proxy ?? null;
    const detectedUrl = status?.detectedUrl;
    const proxyOrigin = proxy ? previewProxyOrigin(proxy.port) : null;

    const iframeRef = useRef<HTMLIFrameElement>(null);
    const urlInputRef = useRef<HTMLInputElement>(null);
    const [iframeSrc, setIframeSrc] = useState<string | null>(null);
    const [iframeKey, setIframeKey] = useState(0);
    const [urlInput, setUrlInput] = useState("");
    const [device, setDevice] = useState<DeviceWidth>("desktop");
    const [annotateMode, setAnnotateMode] = useState(false);
    const annotateModeRef = useRef(false);
    annotateModeRef.current = annotateMode;
    const pageReadyRef = useRef(false);
    const autoStartedForRef = useRef<string | null>(null);
    const currentHrefRef = useRef<string | null>(null);
    /** Flash queued until the target page finishes loading in the iframe. */
    const pendingFlashRef = useRef<UiAnnotation | null>(null);

    const postToPage = useCallback((msg: Record<string, unknown>) => {
      iframeRef.current?.contentWindow?.postMessage(msg, "*");
    }, []);

    /** The page reports proxy-origin URLs; show dev-server URLs instead. */
    const toDisplayUrl = useCallback(
      (href: string) => (proxy && proxyOrigin ? href.replace(proxyOrigin, proxy.targetUrl) : href),
      [proxy, proxyOrigin],
    );

    /** Annotations carry dev-server URLs; the iframe loads via the proxy. */
    const toProxyUrl = useCallback(
      (href: string) => (proxy && proxyOrigin ? href.replace(proxy.targetUrl, proxyOrigin) : href),
      [proxy, proxyOrigin],
    );

    const flashLocation = useCallback((annotation: UiAnnotation) => {
      const samePage = currentHrefRef.current === annotation.pageUrl;
      if (samePage && pageReadyRef.current) {
        postToPage({ type: "hive:flash", selector: annotation.selector, rect: annotation.rect });
        return;
      }
      pendingFlashRef.current = annotation;
      if (!samePage) {
        pageReadyRef.current = false;
        setIframeSrc(toProxyUrl(annotation.pageUrl));
        setIframeKey((k) => k + 1);
      }
    }, [postToPage, toProxyUrl]);

    useImperativeHandle(ref, () => ({
      clearAnnotations: () => postToPage({ type: "hive:clear-annotations" }),
      removeAnnotation: (id: number) => postToPage({ type: "hive:remove-annotation", id }),
      focusAnnotation: (id: number) => postToPage({ type: "hive:focus-annotation", id }),
      flashLocation,
    }), [postToPage, flashLocation]);

    // Auto-start the proxy once per detected dev-server URL.
    useEffect(() => {
      if (proxy || !detectedUrl || isStarting) return;
      if (autoStartedForRef.current === detectedUrl) return;
      autoStartedForRef.current = detectedUrl;
      void start().catch(() => {});
    }, [proxy, detectedUrl, isStarting, start]);

    // Point the iframe at the proxy when it becomes available or is retargeted.
    useEffect(() => {
      if (!proxyOrigin) {
        setIframeSrc(null);
        return;
      }
      setIframeSrc((prev) => (prev?.startsWith(proxyOrigin) ? prev : `${proxyOrigin}/`));
    }, [proxyOrigin]);

    // Bridge messages from the injected annotator.
    useEffect(() => {
      const onMessage = (e: MessageEvent) => {
        if (e.source !== iframeRef.current?.contentWindow) return;
        const msg = e.data as { type?: string } & Record<string, unknown>;
        if (!msg || typeof msg !== "object") return;

        if (msg.type === "hive:annotations") {
          const annotations = (msg.annotations as UiAnnotation[]) ?? [];
          onAnnotationsChange(annotations.map((a) => ({ ...a, pageUrl: toDisplayUrl(a.pageUrl) })));
          setAnnotateMode(Boolean(msg.active));
        } else if (msg.type === "hive:nav" || msg.type === "hive:ready") {
          if (typeof msg.href === "string") {
            currentHrefRef.current = toDisplayUrl(msg.href);
            if (document.activeElement !== urlInputRef.current) {
              setUrlInput(currentHrefRef.current);
            }
          }
          if (msg.type === "hive:ready") {
            // Fresh page load: overlay state reset, re-apply annotate mode.
            pageReadyRef.current = true;
            onAnnotationsChange([]);
            if (annotateModeRef.current) {
              postToPage({ type: "hive:set-annotate-mode", active: true });
            }
            const pending = pendingFlashRef.current;
            if (pending) {
              pendingFlashRef.current = null;
              postToPage({ type: "hive:flash", selector: pending.selector, rect: pending.rect });
            }
          }
        }
      };
      window.addEventListener("message", onMessage);
      return () => window.removeEventListener("message", onMessage);
    }, [onAnnotationsChange, postToPage, toDisplayUrl]);

    const toggleAnnotateMode = useCallback(() => {
      const next = !annotateModeRef.current;
      setAnnotateMode(next);
      postToPage({ type: "hive:set-annotate-mode", active: next });
    }, [postToPage]);

    const reload = useCallback(() => {
      if (pageReadyRef.current) {
        postToPage({ type: "hive:reload" });
      } else {
        // The annotator never loaded (e.g. 502 page without meta refresh yet).
        setIframeKey((k) => k + 1);
      }
      pageReadyRef.current = false;
    }, [postToPage]);

    const navigate = useCallback(async (raw: string) => {
      let input = raw.trim();
      if (!input) return;
      if (!/^https?:\/\//.test(input) && !input.startsWith("/")) input = `http://${input}`;
      if (input.startsWith("/")) {
        if (proxyOrigin) setIframeSrc(proxyOrigin + input);
        return;
      }
      let url: URL;
      try {
        url = new URL(input);
      } catch {
        return;
      }
      const path = url.pathname + url.search + url.hash;
      if (proxy && proxyOrigin && url.origin === new URL(proxy.targetUrl).origin) {
        setIframeSrc(proxyOrigin + path);
        setIframeKey((k) => k + 1);
        return;
      }
      // Different dev server: retarget the proxy, then load the new page.
      try {
        const next = await start(url.origin);
        if (next.proxy) {
          setIframeSrc(previewProxyOrigin(next.proxy.port) + path);
          setIframeKey((k) => k + 1);
        }
      } catch {
        // startError is surfaced below the toolbar.
      }
    }, [proxy, proxyOrigin, start]);

    const deviceWidth = DEVICE_WIDTHS[device];

    const toolbarButton = (activeState?: boolean) =>
      cn(
        "flex h-6 items-center gap-1 rounded-md px-1.5 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground",
        activeState && "bg-primary/10 text-primary ring-1 ring-primary/15 hover:bg-primary/15 hover:text-primary",
      );

    return (
      <div className="flex h-full min-h-0 flex-col">
        {/* Toolbar */}
        <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/40 px-2">
          <button type="button" className={toolbarButton()} title="Back" onClick={() => postToPage({ type: "hive:navigate", delta: -1 })}>
            <ArrowLeftIcon className="size-3.5" />
          </button>
          <button type="button" className={toolbarButton()} title="Forward" onClick={() => postToPage({ type: "hive:navigate", delta: 1 })}>
            <ArrowRightIcon className="size-3.5" />
          </button>
          <button type="button" className={toolbarButton()} title="Reload" onClick={reload}>
            <RotateCwIcon className="size-3.5" />
          </button>
          <input
            ref={urlInputRef}
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void navigate(urlInput);
                urlInputRef.current?.blur();
              }
            }}
            placeholder={detectedUrl ?? "http://localhost:3000"}
            spellCheck={false}
            className="h-6 min-w-0 flex-1 rounded-md border border-border/40 bg-field px-2 font-mono text-[11px] text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-primary/40"
          />
          <div className="flex items-center rounded-md border border-border/40">
            {(["desktop", "tablet", "mobile"] as const).map((d) => {
              const Icon = d === "desktop" ? MonitorIcon : d === "tablet" ? TabletIcon : SmartphoneIcon;
              return (
                <button
                  key={d}
                  type="button"
                  title={d}
                  onClick={() => setDevice(d)}
                  className={cn(
                    "flex h-6 items-center px-1.5 text-muted-foreground transition-colors first:rounded-l-md last:rounded-r-md hover:text-foreground",
                    device === d && "bg-accent/60 text-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className={toolbarButton(annotateMode)}
            title="Annotate: click an element or drag an area, leave a note for the agent"
            onClick={toggleAnnotateMode}
            disabled={!proxy}
          >
            <PencilLineIcon className="size-3.5" />
            <span className="text-[11px]">Annotate</span>
            {annotationCount > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-4 text-primary-foreground">
                {annotationCount}
              </span>
            )}
          </button>
          <button
            type="button"
            className={toolbarButton()}
            title="Open in external browser"
            onClick={() => {
              const url = urlInput || proxy?.targetUrl || detectedUrl;
              if (url) void openExternal(url);
            }}
            disabled={!urlInput && !proxy && !detectedUrl}
          >
            <ExternalLinkIcon className="size-3.5" />
          </button>
        </div>

        {startError && (
          <div className="border-b border-destructive/20 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
            {startError}
          </div>
        )}

        {/* Content */}
        {proxy && iframeSrc ? (
          <div className="flex min-h-0 flex-1 justify-center overflow-auto bg-muted/40">
            <iframe
              key={iframeKey}
              ref={iframeRef}
              src={iframeSrc}
              title="Workspace preview"
              className={cn("h-full border-0 bg-white", deviceWidth ? "shadow-md" : "w-full")}
              style={deviceWidth ? { width: deviceWidth } : undefined}
              allow="clipboard-read; clipboard-write"
            />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/20 p-6">
            <div className="w-full max-w-sm text-center">
              <GlobeIcon className="mx-auto size-8 text-muted-foreground/40" />
              <div className="mt-3 text-sm font-medium text-foreground">Preview your app</div>
              <p className="mt-1 text-xs text-muted-foreground">
                {detectedUrl
                  ? `Dev server detected at ${detectedUrl}.`
                  : "Start a run script and Hive detects the dev server automatically, or enter its URL."}
              </p>
              <div className="mt-4 flex items-center gap-2">
                <input
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void navigate(urlInput || detectedUrl || "")}
                  placeholder={detectedUrl ?? "http://localhost:3000"}
                  spellCheck={false}
                  className="h-8 min-w-0 flex-1 rounded-md border border-border/40 bg-field px-2 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-primary/40"
                />
                <button
                  type="button"
                  disabled={isStarting || (!urlInput.trim() && !detectedUrl)}
                  onClick={() => void navigate(urlInput || detectedUrl || "")}
                  className="h-8 shrink-0 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isStarting ? "Starting…" : "Open preview"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  },
);
