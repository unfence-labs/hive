import { describe, it, expect, afterEach, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import {
  _clearAllPreviews,
  getDetectedPreviewUrl,
  getPreviewProxy,
  notePreviewOutput,
  PREVIEW_AUTH_PATH,
  startPreviewProxy,
  stopPreviewProxy,
} from "./preview-proxy.js";
import { ANNOTATOR_PATH } from "./preview-annotator.js";

// ── Fake dev server (HTTP + WS echo) ─────────────────────────────────

let devServer: http.Server;
let devPort: number;
let savedHost: string | undefined;

beforeAll(async () => {
  // The proxy binds to HOST (so remote frontends can reach it); pin it to
  // loopback for hermetic tests regardless of the environment.
  savedHost = process.env.HOST;
  process.env.HOST = "127.0.0.1";
  devServer = http.createServer((req, res) => {
    if (req.url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "x-frame-options": "DENY" });
      res.end("<!DOCTYPE html><html><head></head><body><h1>app</h1></body></html>");
    } else if (req.url === "/no-body-tag") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<h1>fragment</h1>");
    } else if (req.url === "/data.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    } else if (req.url === "/echo-cookies") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ cookie: req.headers.cookie ?? null }));
    } else {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    }
  });
  const wss = new WebSocketServer({ server: devServer });
  wss.on("connection", (socket) => {
    socket.on("message", (data) => socket.send(`echo:${data.toString()}`));
  });
  await new Promise<void>((r) => devServer.listen(0, "127.0.0.1", r));
  devPort = (devServer.address() as { port: number }).port;
});

afterAll(async () => {
  if (savedHost === undefined) delete process.env.HOST;
  else process.env.HOST = savedHost;
  await new Promise((r) => devServer.close(r));
});

afterEach(() => {
  _clearAllPreviews();
});

async function fetchProxy(
  port: number,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; headers: Headers; body: string }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
  return { status: res.status, headers: res.headers, body: await res.text() };
}

describe("preview proxy", () => {
  it("proxies HTML with the annotator injected and frame headers stripped", async () => {
    const info = await startPreviewProxy("ws-1", `http://127.0.0.1:${devPort}`);
    const res = await fetchProxy(info.port, "/");

    expect(res.status).toBe(200);
    expect(res.body).toContain("<h1>app</h1>");
    expect(res.body).toContain(`<script src="${ANNOTATOR_PATH}" data-hive-annotator></script></body>`);
    expect(res.headers.get("x-frame-options")).toBeNull();
  });

  it("injects into HTML without a body tag", async () => {
    const info = await startPreviewProxy("ws-1", `http://127.0.0.1:${devPort}`);
    const res = await fetchProxy(info.port, "/no-body-tag");
    expect(res.body).toContain(ANNOTATOR_PATH);
  });

  it("passes non-HTML responses through untouched", async () => {
    const info = await startPreviewProxy("ws-1", `http://127.0.0.1:${devPort}`);
    const res = await fetchProxy(info.port, "/data.json");
    expect(res.body).toBe('{"ok":true}');
    expect(res.status).toBe(200);
  });

  it("serves the annotator script", async () => {
    const info = await startPreviewProxy("ws-1", `http://127.0.0.1:${devPort}`);
    const res = await fetchProxy(info.port, ANNOTATOR_PATH);
    expect(res.status).toBe(200);
    expect(res.body).toContain("__hiveAnnotator");
  });

  it("tunnels WebSocket upgrades to the dev server", async () => {
    const info = await startPreviewProxy("ws-1", `http://127.0.0.1:${devPort}`);
    const ws = new WebSocket(`ws://127.0.0.1:${info.port}/hmr`);
    const reply = await new Promise<string>((resolvePromise, reject) => {
      ws.on("open", () => ws.send("ping"));
      ws.on("message", (data) => resolvePromise(data.toString()));
      ws.on("error", reject);
    });
    ws.close();
    expect(reply).toBe("echo:ping");
  });

  it("returns a retrying 502 page when the dev server is down", async () => {
    const info = await startPreviewProxy("ws-1", "http://127.0.0.1:1");
    const res = await fetchProxy(info.port, "/");
    expect(res.status).toBe(502);
    expect(res.body).toContain("http-equiv=\"refresh\"");
  });

  it("is idempotent and retargets an existing proxy", async () => {
    const first = await startPreviewProxy("ws-1", "http://127.0.0.1:1");
    const second = await startPreviewProxy("ws-1", `http://127.0.0.1:${devPort}`);
    expect(second.port).toBe(first.port);
    expect(getPreviewProxy("ws-1")?.targetUrl).toBe(`http://127.0.0.1:${devPort}`);

    const res = await fetchProxy(second.port, "/");
    expect(res.status).toBe(200);
  });

  it("stops and reports proxies per workspace", async () => {
    await startPreviewProxy("ws-1", `http://127.0.0.1:${devPort}`);
    expect(getPreviewProxy("ws-1")).not.toBeNull();
    expect(stopPreviewProxy("ws-1")).toBe(true);
    expect(getPreviewProxy("ws-1")).toBeNull();
    expect(stopPreviewProxy("ws-1")).toBe(false);
  });

  it("rejects non-http target URLs", async () => {
    await expect(startPreviewProxy("ws-1", "file:///etc/passwd")).rejects.toThrow(/protocol/);
  });
});

describe("preview proxy auth", () => {
  const TOKEN = "secret123";
  const COOKIE = `hive_preview_token=${TOKEN}`;
  let savedToken: string | undefined;

  beforeAll(() => {
    savedToken = process.env.HIVE_AUTH_TOKEN;
    process.env.HIVE_AUTH_TOKEN = TOKEN;
  });

  afterAll(() => {
    if (savedToken === undefined) delete process.env.HIVE_AUTH_TOKEN;
    else process.env.HIVE_AUTH_TOKEN = savedToken;
  });

  it("rejects plain requests without the auth cookie", async () => {
    const info = await startPreviewProxy("ws-1", `http://127.0.0.1:${devPort}`);
    const res = await fetchProxy(info.port, "/");
    expect(res.status).toBe(403);
  });

  it("bootstraps a cookie via the auth redirect, then serves the app", async () => {
    const info = await startPreviewProxy("ws-1", `http://127.0.0.1:${devPort}`);
    const auth = await fetchProxy(info.port, `${PREVIEW_AUTH_PATH}?token=${TOKEN}&next=%2F`, {
      redirect: "manual",
    });
    expect(auth.status).toBe(302);
    expect(auth.headers.get("location")).toBe("/");
    const setCookie = auth.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("hive_preview_token");
    const cookie = setCookie.split(";")[0];

    const page = await fetchProxy(info.port, "/", { headers: { cookie } });
    expect(page.status).toBe(200);
    expect(page.body).toContain(ANNOTATOR_PATH);
  });

  it("rejects the auth redirect with a wrong token", async () => {
    const info = await startPreviewProxy("ws-1", `http://127.0.0.1:${devPort}`);
    const res = await fetchProxy(info.port, `${PREVIEW_AUTH_PATH}?token=wrong`, {
      redirect: "manual",
    });
    expect(res.status).toBe(403);
  });

  it("rejects absolute redirect targets in the auth bootstrap", async () => {
    const info = await startPreviewProxy("ws-1", `http://127.0.0.1:${devPort}`);
    const res = await fetchProxy(
      info.port,
      `${PREVIEW_AUTH_PATH}?token=${TOKEN}&next=${encodeURIComponent("http://evil.example")}`,
      { redirect: "manual" },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
  });

  it("rejects protocol-relative redirect targets in the auth bootstrap", async () => {
    const info = await startPreviewProxy("ws-1", `http://127.0.0.1:${devPort}`);
    const res = await fetchProxy(
      info.port,
      `${PREVIEW_AUTH_PATH}?token=${TOKEN}&next=${encodeURIComponent("//evil.example")}`,
      { redirect: "manual" },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
  });

  it("rejects WebSocket upgrades without the cookie and tunnels them with it", async () => {
    const info = await startPreviewProxy("ws-1", `http://127.0.0.1:${devPort}`);

    const unauthorized = new WebSocket(`ws://127.0.0.1:${info.port}/hmr`);
    const failure = await new Promise<Error>((resolvePromise, reject) => {
      unauthorized.on("error", resolvePromise);
      unauthorized.on("open", () => reject(new Error("upgrade should have been rejected")));
    });
    expect(failure.message).toContain("403");

    const authorized = new WebSocket(`ws://127.0.0.1:${info.port}/hmr`, {
      headers: { cookie: COOKIE },
    });
    const reply = await new Promise<string>((resolvePromise, reject) => {
      authorized.on("open", () => authorized.send("ping"));
      authorized.on("message", (data) => resolvePromise(data.toString()));
      authorized.on("error", reject);
    });
    authorized.close();
    expect(reply).toBe("echo:ping");
  });

  it("strips the auth cookie before forwarding upstream", async () => {
    const info = await startPreviewProxy("ws-1", `http://127.0.0.1:${devPort}`);

    const mixed = await fetchProxy(info.port, "/echo-cookies", {
      headers: { cookie: `${COOKIE}; theme=dark` },
    });
    expect(mixed.status).toBe(200);
    expect(JSON.parse(mixed.body)).toEqual({ cookie: "theme=dark" });

    const only = await fetchProxy(info.port, "/echo-cookies", {
      headers: { cookie: COOKIE },
    });
    expect(only.status).toBe(200);
    expect(JSON.parse(only.body)).toEqual({ cookie: null });
  });
});

describe("notePreviewOutput", () => {
  it("detects a localhost URL in script output", () => {
    expect(notePreviewOutput("ws-1", "  Local:   http://localhost:5173/\n")).toBe(
      "http://localhost:5173/",
    );
    expect(getDetectedPreviewUrl("ws-1")).toBe("http://localhost:5173/");
  });

  it("strips ANSI escapes and normalizes bind addresses", () => {
    expect(notePreviewOutput("ws-2", "\x1b[32mready\x1b[0m on http://0.0.0.0:3000\n")).toBe(
      "http://localhost:3000",
    );
  });

  it("matches URLs split across PTY chunks", () => {
    expect(notePreviewOutput("ws-3", "Local: http://loc")).toBeNull();
    expect(notePreviewOutput("ws-3", "alhost:4321/")).toBe("http://localhost:4321/");
  });

  it("reports a URL only once until it changes", () => {
    notePreviewOutput("ws-4", "http://localhost:5173/\n");
    expect(notePreviewOutput("ws-4", "http://localhost:5173/\n")).toBeNull();
    expect(notePreviewOutput("ws-4", "restarted on http://localhost:5174/\n")).toBe(
      "http://localhost:5174/",
    );
  });

  it("ignores non-local URLs", () => {
    expect(notePreviewOutput("ws-5", "see https://vitejs.dev/config\n")).toBeNull();
  });
});
