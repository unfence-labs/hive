import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerUrl: vi.fn(),
}));

vi.mock("@/hooks/useServerUrl", () => ({ getServerUrl: mocks.getServerUrl }));

import { buildWsUrl } from "@/lib/ws-url";

describe("buildWsUrl", () => {
  beforeEach(() => {
    mocks.getServerUrl.mockReset();
    mocks.getServerUrl.mockReturnValue("");
    delete import.meta.env.VITE_HIVE_AUTH_TOKEN;
    delete import.meta.env.VITE_WS_URL;
  });

  it("derives the ws host from the configured http server URL", () => {
    mocks.getServerUrl.mockReturnValue("http://127.0.0.1:9000");
    expect(buildWsUrl("/ws/terminal/ws-1", { sessionId: "s1" })).toBe(
      "ws://127.0.0.1:9000/ws/terminal/ws-1?sessionId=s1",
    );
  });

  it("upgrades https server URLs to wss", () => {
    mocks.getServerUrl.mockReturnValue("https://remote.example.dev");
    expect(buildWsUrl("/ws/script/ws-1", { type: "setup" })).toBe(
      "wss://remote.example.dev/ws/script/ws-1?type=setup",
    );
  });

  it("appends the auth token when configured", () => {
    mocks.getServerUrl.mockReturnValue("http://127.0.0.1:9000");
    import.meta.env.VITE_HIVE_AUTH_TOKEN = "  secret token  ";
    expect(buildWsUrl("/ws/terminal/ws-1", { sessionId: "s1" })).toBe(
      "ws://127.0.0.1:9000/ws/terminal/ws-1?sessionId=s1&token=secret+token",
    );
  });

  it("falls back to VITE_WS_URL when no server URL is set", () => {
    import.meta.env.VITE_WS_URL = "wss://example-ws.acme.dev";
    expect(buildWsUrl("/ws/script/ws-1", { type: "run" })).toBe(
      "wss://example-ws.acme.dev/ws/script/ws-1?type=run",
    );
  });

  it("omits the query string when there are no params and no token", () => {
    mocks.getServerUrl.mockReturnValue("http://127.0.0.1:9000");
    expect(buildWsUrl("/ws/terminal/ws-1")).toBe("ws://127.0.0.1:9000/ws/terminal/ws-1");
  });
});
