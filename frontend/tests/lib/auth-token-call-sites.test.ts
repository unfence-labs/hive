import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/hooks/useApi";
import { replaceConnection } from "@/hooks/useConnection";
import { buildWsUrl } from "@/lib/ws-url";
import { buildBrowserStreamUrl } from "@/lib/browser-stream";
import { resolveApiResourceSrc } from "@/lib/image-url";
import { wsTransport } from "@/lib/ws-transport";

/**
 * The token is only useful if it reaches every transport. These cover the five
 * call sites named in the acceptance criteria, plus the rule that a caller's own
 * auth header wins.
 */
describe("the runtime token reaches every outbound call", () => {
  beforeEach(() => {
    localStorage.clear();
    replaceConnection({ host: "host", port: 3000, authToken: "runtime-tok" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("REST requests carry it as a bearer header", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await api.get("/api/x");

    expect(fetchMock).toHaveBeenCalledWith("http://host:3000/api/x", {
      headers: { Authorization: "Bearer runtime-tok" },
    });
  });

  it("a caller that set its own auth header is not overridden", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await api.get("/api/x", { headers: { Authorization: "Bearer caller" } });
    await api.get("/api/y", { headers: { "x-hive-token": "caller" } });

    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Authorization: "Bearer caller" });
    expect(fetchMock.mock.calls[1][1].headers).toEqual({ "x-hive-token": "caller" });
  });

  it("PTY sockets carry it as a query parameter", () => {
    expect(buildWsUrl("/ws/terminal/ws-1")).toBe("ws://host:3000/ws/terminal/ws-1?token=runtime-tok");
    expect(buildWsUrl("/ws/script/ws-1", { type: "run" }))
      .toBe("ws://host:3000/ws/script/ws-1?type=run&token=runtime-tok");
  });

  it("the browser-screencast socket carries it", () => {
    expect(buildBrowserStreamUrl("/ws/browser")).toBe("ws://host:3000/ws/browser?token=runtime-tok");
  });

  it("authenticated image URLs carry it", () => {
    expect(resolveApiResourceSrc("/api/img/1.png"))
      .toBe("http://host:3000/api/img/1.png?token=runtime-tok");
  });

  it("the hub WebSocket carries it", () => {
    const urls: string[] = [];
    class FakeWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = 0;
      onopen: (() => void) | null = null;
      onmessage: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(url: string) { urls.push(url); }
      send() {}
      close() {}
    }
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);

    try {
      wsTransport.connect("ws-token-test");
      expect(urls).toEqual(["ws://host:3000/ws/hub?token=runtime-tok"]);
    } finally {
      wsTransport.disconnectAll();
    }
  });

  it("sends no token at all when the record carries none", async () => {
    replaceConnection({ host: "host", port: 3000 });
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await api.get("/api/x");

    expect(fetchMock).toHaveBeenCalledWith("http://host:3000/api/x", { headers: {} });
    expect(buildWsUrl("/ws/terminal/ws-1")).toBe("ws://host:3000/ws/terminal/ws-1");
    expect(buildBrowserStreamUrl("/ws/browser")).toBe("ws://host:3000/ws/browser");
    expect(resolveApiResourceSrc("/api/img/1.png")).toBe("http://host:3000/api/img/1.png");
  });
});
