import { beforeEach, describe, expect, it, vi } from "vitest";
import { getConnection } from "@/hooks/useConnection";
import { queryClient } from "@/lib/query-client";
import { wsTransport } from "@/lib/ws-transport";
import { ServerConnectionError, switchServer } from "@/lib/server-connection";

describe("switchServer", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("probes with the proposed token before replacing the connection", async () => {
    const disconnect = vi.spyOn(wsTransport, "disconnectAll");
    const clear = vi.spyOn(queryClient, "clear");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    await switchServer(
      { host: "100.64.0.10", port: 3000, sshUser: "root", authToken: "token" },
      { verify: true },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://100.64.0.10:3000/api/projects",
      expect.objectContaining({ headers: { Authorization: "Bearer token" } }),
    );
    expect(disconnect).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
    expect(getConnection()).toMatchObject({ host: "100.64.0.10", authToken: "token" });
  });

  it("replaces the connection before transport cleanup", async () => {
    await switchServer({ host: "old.ts.net", port: 3000 });
    vi.spyOn(wsTransport, "disconnectAll").mockImplementation(() => {
      expect(getConnection()).toBeNull();
    });

    await switchServer(null);

    expect(getConnection()).toBeNull();
  });

  it("keeps the current connection when the proposed token is rejected", async () => {
    await switchServer({ host: "old.ts.net", port: 3000 });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 401 }));

    await expect(
      switchServer(
        { host: "new.ts.net", port: 3000, authToken: "bad" },
        { verify: true },
      ),
    ).rejects.toMatchObject<Partial<ServerConnectionError>>({ reason: "unauthorized" });
    expect(getConnection()?.host).toBe("old.ts.net");
  });

  it("rejects invalid hosts and ports before any network request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(
      switchServer({ host: "-oProxyCommand=bad", port: 70000 }, { verify: true }),
    ).rejects.toMatchObject<Partial<ServerConnectionError>>({ reason: "invalid" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
