import { beforeEach, describe, expect, it } from "vitest";
import { replaceConnection } from "@/hooks/useConnection";

import { buildWsUrl } from "@/lib/ws-url";

describe("buildWsUrl", () => {
  beforeEach(() => {
    localStorage.clear();
    delete import.meta.env.VITE_WS_URL;
  });

  it("derives the ws host from the configured http server URL", () => {
    replaceConnection({ host: "127.0.0.1", port: 9000 });
    expect(buildWsUrl("/ws/terminal/ws-1", { sessionId: "s1" })).toBe(
      "ws://127.0.0.1:9000/ws/terminal/ws-1?sessionId=s1",
    );
  });

  it("upgrades https server URLs to wss and omits the default port", () => {
    replaceConnection({ host: "remote.example.dev", port: 443, protocol: "https" });
    expect(buildWsUrl("/ws/script/ws-1", { type: "setup" })).toBe(
      "wss://remote.example.dev/ws/script/ws-1?type=setup",
    );
  });

  it("bracket-wraps IPv6 hosts", () => {
    replaceConnection({ host: "fd7a:115c:a1e0::1", port: 3000 });
    expect(buildWsUrl("/ws/terminal/ws-1")).toBe("ws://[fd7a:115c:a1e0::1]:3000/ws/terminal/ws-1");
  });

  it("appends the runtime token from the connection record", () => {
    replaceConnection({ host: "127.0.0.1", port: 9000, authToken: "secret token" });
    expect(buildWsUrl("/ws/terminal/ws-1", { sessionId: "s1" })).toBe(
      "ws://127.0.0.1:9000/ws/terminal/ws-1?sessionId=s1&token=secret+token",
    );
  });

  it("falls back to VITE_WS_URL when no server is configured", () => {
    import.meta.env.VITE_WS_URL = "wss://example-ws.acme.dev";
    expect(buildWsUrl("/ws/script/ws-1", { type: "run" })).toBe(
      "wss://example-ws.acme.dev/ws/script/ws-1?type=run",
    );
  });

  it("omits the query string when there are no params and no token", () => {
    replaceConnection({ host: "127.0.0.1", port: 9000 });
    expect(buildWsUrl("/ws/terminal/ws-1")).toBe("ws://127.0.0.1:9000/ws/terminal/ws-1");
  });
});
