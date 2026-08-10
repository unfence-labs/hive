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
    const reset = vi.spyOn(queryClient, "resetQueries");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    await switchServer(
      { host: "100.64.0.10", port: 3000, sshUser: "hive", authToken: "token" },
      { verify: true },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://100.64.0.10:3000/api/projects",
      expect.objectContaining({ headers: { Authorization: "Bearer token" } }),
    );
    expect(disconnect).toHaveBeenCalledOnce();
    expect(reset).toHaveBeenCalledOnce();
    expect(getConnection()).toMatchObject({ host: "100.64.0.10", authToken: "token" });
  });

  it("reports a rejected token distinctly from an unreachable server", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 401 }));
    await expect(
      switchServer({ host: "server.example.com", port: 3000, authToken: "bad" }, { verify: true }),
    ).rejects.toMatchObject<Partial<ServerConnectionError>>({ reason: "unauthorized" });

    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(
      switchServer({ host: "server.example.com", port: 3000 }, { verify: true }),
    ).rejects.toMatchObject<Partial<ServerConnectionError>>({ reason: "unreachable" });
  });

  it("keeps the current connection when the proposed one is rejected", async () => {
    await switchServer({ host: "old.example.com", port: 3000, authToken: "good" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 401 }));

    await expect(
      switchServer({ host: "new.example.com", port: 3000, authToken: "bad" }, { verify: true }),
    ).rejects.toBeInstanceOf(ServerConnectionError);

    expect(getConnection()).toMatchObject({ host: "old.example.com", authToken: "good" });
  });

  it("rejects hosts and users that could be read as command-line options", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(
      switchServer({ host: "-oProxyCommand=bad", port: 3000 }, { verify: true }),
    ).rejects.toMatchObject<Partial<ServerConnectionError>>({ reason: "invalid" });
    await expect(
      switchServer({ host: "server.example.com", port: 70_000 }, { verify: true }),
    ).rejects.toMatchObject<Partial<ServerConnectionError>>({ reason: "invalid" });
    await expect(
      switchServer({ host: "server.example.com", port: 3000, adminUser: "-oProxyCommand=bad" }),
    ).rejects.toMatchObject<Partial<ServerConnectionError>>({ reason: "invalid" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(getConnection()).toBeNull();
  });

  it("accepts SSH users that start with a digit", async () => {
    await switchServer({ host: "server.example.com", port: 3000, sshUser: "2root" });

    expect(getConnection()).toMatchObject({ sshUser: "2root" });
  });

  it("clears the connection and tears down live transports", async () => {
    await switchServer({ host: "old.example.com", port: 3000 });
    const disconnect = vi.spyOn(wsTransport, "disconnectAll");

    await switchServer(null);

    expect(getConnection()).toBeNull();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
