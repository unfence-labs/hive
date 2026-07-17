import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/hooks/useApi";
import { buildWsUrl } from "@/lib/ws-url";
import { buildBrowserStreamUrl } from "@/lib/browser-stream";
import { resolveApiResourceSrc } from "@/lib/image-url";
import { wsTransport } from "@/lib/ws-transport";

const TOKEN_KEY = "hive-auth-token";
const SERVER_KEY = "hive-server-url";

describe("runtime auth token is read at each replaced call site", () => {
  beforeEach(() => {
    localStorage.setItem(TOKEN_KEY, "runtime-tok");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(SERVER_KEY);
    delete import.meta.env.VITE_HIVE_AUTH_TOKEN;
  });

  it("useApi sends the runtime token as a bearer header", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await api.get("/api/x");
    expect(fetchMock).toHaveBeenCalledWith("/api/x", {
      headers: { Authorization: "Bearer runtime-tok" },
    });
  });

  it("ws-url appends the runtime token", () => {
    localStorage.setItem(SERVER_KEY, "http://host:3000");
    const url = buildWsUrl("/ws/terminal");
    expect(url).toBe("ws://host:3000/ws/terminal?token=runtime-tok");
  });

  it("browser-stream appends the runtime token", () => {
    localStorage.setItem(SERVER_KEY, "http://host:3000");
    const url = buildBrowserStreamUrl("/ws/browser");
    expect(url).toBe("ws://host:3000/ws/browser?token=runtime-tok");
  });

  it("image-url appends the runtime token", () => {
    localStorage.setItem(SERVER_KEY, "http://host:3000");
    const src = resolveApiResourceSrc("/api/img/1.png");
    expect(src).toContain("token=runtime-tok");
  });

  it("ws-transport opens the hub socket with the runtime token", () => {
    localStorage.setItem(SERVER_KEY, "http://host:3000");
    const urls: string[] = [];
    class FakeWebSocket {
      static OPEN = 1;
      static CONNECTING = 0;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = 0;
      onopen: (() => void) | null = null;
      onmessage: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(url: string) {
        urls.push(url);
      }
      send() {}
      close() {}
    }
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
    try {
      wsTransport.connect("ws-token-test");
      expect(urls.some((u) => u.includes("/ws/hub?token=runtime-tok"))).toBe(true);
    } finally {
      wsTransport.disconnectAll();
    }
  });
});
