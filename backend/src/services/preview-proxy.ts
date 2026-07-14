import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { ANNOTATOR_PATH, ANNOTATOR_SCRIPT } from "./preview-annotator.js";

/**
 * Per-workspace reverse proxy that renders the user's dev server inside the
 * Hive preview panel. It listens on its own loopback port and forwards
 * everything (including WebSocket upgrades, so HMR keeps working) to the
 * target dev server, injecting the annotation overlay script into HTML
 * responses. Proxying at the root of a dedicated port keeps absolute asset
 * URLs (`/assets/x.js`) working without any rewriting.
 */

export interface PreviewProxyInfo {
  port: number;
  targetUrl: string;
}

interface PreviewEntry {
  server: http.Server;
  port: number;
  target: URL;
}

/** Hop-by-hop headers (RFC 2616) plus frame/CSP headers that would block the
 *  iframe embed or the injected script. */
const STRIPPED_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-security-policy",
  "content-security-policy-report-only",
  "x-frame-options",
]);

const proxies = new Map<string, PreviewEntry>();
const detectedUrls = new Map<string, string>();
/** Rolling PTY output tail per workspace so URLs split across chunks match. */
const outputTails = new Map<string, string>();

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;
const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d+)?(?:\/[^\s"'`|)\]]*)?/g;

/**
 * Scan a PTY output chunk for a local dev-server URL. Returns the normalized
 * URL when a new one is detected for this workspace, otherwise null.
 */
export function notePreviewOutput(wsId: string, chunk: string): string | null {
  const tail = (outputTails.get(wsId) ?? "") + chunk.replace(ANSI_RE, "");
  outputTails.set(wsId, tail.slice(-2048));
  // Most recent URL wins: a restarted dev server prints a new port below the
  // old one within the rolling tail.
  const matches = [...tail.matchAll(URL_RE)];
  if (matches.length === 0) return null;
  let url = matches[matches.length - 1][0].replace(/[.,:;]+$/, "");
  // Bind-address hosts aren't browsable; normalize to localhost.
  url = url.replace("0.0.0.0", "localhost").replace(/\[::1?\]/, "localhost");
  if (detectedUrls.get(wsId) === url) return null;
  detectedUrls.set(wsId, url);
  return url;
}

export function getDetectedPreviewUrl(wsId: string): string | undefined {
  return detectedUrls.get(wsId);
}

function injectAnnotator(html: string): string {
  const tag = `<script src="${ANNOTATOR_PATH}" data-hive-annotator></script>`;
  const bodyClose = html.search(/<\/body\s*>/i);
  if (bodyClose !== -1) return html.slice(0, bodyClose) + tag + html.slice(bodyClose);
  const htmlClose = html.search(/<\/html\s*>/i);
  if (htmlClose !== -1) return html.slice(0, htmlClose) + tag + html.slice(htmlClose);
  return html + tag;
}

function unreachablePage(target: URL): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="2"><title>Waiting for dev server</title></head><body style="font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#6b7280;background:#fafafa"><div style="text-align:center"><div style="font-size:15px;font-weight:600;color:#374151">Waiting for ${target.origin}&hellip;</div><div style="font-size:13px;margin-top:6px">The dev server is not responding yet. This page retries automatically.</div></div></body></html>`;
}

function buildRequestHeaders(req: http.IncomingMessage, target: URL): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    // Ask upstream for identity encoding so HTML can be inspected/injected
    // without decompression plumbing (negligible cost on loopback).
    if (lower === "accept-encoding" || lower === "connection") continue;
    if (lower === "host") continue;
    headers[key] = value;
  }
  headers.host = target.host;
  return headers;
}

function handleRequest(entry: PreviewEntry, req: http.IncomingMessage, res: http.ServerResponse): void {
  if (req.url === ANNOTATOR_PATH) {
    res.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(ANNOTATOR_SCRIPT);
    return;
  }

  const target = entry.target;
  const client = target.protocol === "https:" ? https : http;
  const upstream = client.request(
    {
      hostname: target.hostname,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      path: req.url,
      method: req.method,
      headers: buildRequestHeaders(req, target),
      // Dev servers often run with self-signed certs.
      rejectUnauthorized: false,
    },
    (upstreamRes) => {
      const headers: http.OutgoingHttpHeaders = {};
      for (const [key, value] of Object.entries(upstreamRes.headers)) {
        if (!STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) headers[key] = value;
      }

      const contentType = String(upstreamRes.headers["content-type"] ?? "");
      if (contentType.includes("text/html")) {
        const chunks: Buffer[] = [];
        upstreamRes.on("data", (c: Buffer) => chunks.push(c));
        upstreamRes.on("end", () => {
          const html = injectAnnotator(Buffer.concat(chunks).toString("utf-8"));
          delete headers["content-length"];
          delete headers["content-encoding"];
          headers["content-length"] = Buffer.byteLength(html);
          res.writeHead(upstreamRes.statusCode ?? 200, headers);
          res.end(html);
        });
        upstreamRes.on("error", () => res.destroy());
      } else {
        res.writeHead(upstreamRes.statusCode ?? 200, headers);
        upstreamRes.pipe(res);
      }
    },
  );

  upstream.on("error", () => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(502, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(unreachablePage(target));
  });

  req.pipe(upstream);
  req.on("error", () => upstream.destroy());
}

/** Tunnel WebSocket upgrades (Vite/Next HMR) straight to the dev server. */
function handleUpgrade(entry: PreviewEntry, req: http.IncomingMessage, socket: net.Socket, head: Buffer): void {
  const target = entry.target;
  const port = Number(target.port) || (target.protocol === "https:" ? 443 : 80);
  const upstream: net.Socket =
    target.protocol === "https:"
      ? tls.connect({ host: target.hostname, port, rejectUnauthorized: false }, onConnect)
      : net.connect(port, target.hostname, onConnect);

  function onConnect() {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const key = req.rawHeaders[i];
      const value = key.toLowerCase() === "host" ? target.host : req.rawHeaders[i + 1];
      lines.push(`${key}: ${value}`);
    }
    upstream.write(lines.join("\r\n") + "\r\n\r\n");
    if (head.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  }

  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
}

/**
 * Start (or retarget) the preview proxy for a workspace. Idempotent: an
 * existing proxy keeps its port and simply points at the new target URL.
 */
export async function startPreviewProxy(wsId: string, targetUrl: string): Promise<PreviewProxyInfo> {
  const target = new URL(targetUrl);
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error(`Unsupported preview URL protocol: ${target.protocol}`);
  }

  const existing = proxies.get(wsId);
  if (existing) {
    existing.target = target;
    return { port: existing.port, targetUrl: target.origin };
  }

  const entry: PreviewEntry = { target, port: 0, server: undefined as unknown as http.Server };
  entry.server = http.createServer((req, res) => handleRequest(entry, req, res));
  entry.server.on("upgrade", (req, socket, head) => handleUpgrade(entry, req, socket as net.Socket, head));

  const host = process.env.HOST ?? "127.0.0.1";
  await new Promise<void>((resolvePort, rejectPort) => {
    entry.server.once("error", rejectPort);
    entry.server.listen(0, host, () => {
      entry.server.removeListener("error", rejectPort);
      const address = entry.server.address();
      if (address && typeof address === "object") entry.port = address.port;
      resolvePort();
    });
  });

  proxies.set(wsId, entry);
  return { port: entry.port, targetUrl: target.origin };
}

export function getPreviewProxy(wsId: string): PreviewProxyInfo | null {
  const entry = proxies.get(wsId);
  return entry ? { port: entry.port, targetUrl: entry.target.origin } : null;
}

export function stopPreviewProxy(wsId: string): boolean {
  const entry = proxies.get(wsId);
  if (!entry) return false;
  proxies.delete(wsId);
  entry.server.close();
  entry.server.closeAllConnections();
  return true;
}

/** Stop every preview proxy (graceful shutdown). */
export function stopAllPreviewProxies(): void {
  for (const wsId of [...proxies.keys()]) stopPreviewProxy(wsId);
}

/** For test cleanup. */
export function _clearAllPreviews(): void {
  stopAllPreviewProxies();
  detectedUrls.clear();
  outputTails.clear();
}
