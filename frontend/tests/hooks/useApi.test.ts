import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "@/hooks/useApi";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete import.meta.env.VITE_HIVE_AUTH_TOKEN;
    localStorage.removeItem("hive-server-url");
  });

  it("parses JSON for successful GET requests", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse([{ id: 1 }]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await api.get<Array<{ id: number }>>("/api/items");

    expect(result).toEqual([{ id: 1 }]);
    expect(fetchMock).toHaveBeenCalledWith("/api/items", { headers: {} });
  });

  it("returns undefined on 204 responses", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await api.delete<undefined>("/api/items/1");

    expect(result).toBeUndefined();
  });

  it("prefixes requests with configured server URL", async () => {
    localStorage.setItem("hive-server-url", "http://127.0.0.1:9000");
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse([{ id: 1 }]));
    vi.stubGlobal("fetch", fetchMock);

    await api.get("/api/items");

    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:9000/api/items", {
      headers: {},
    });
  });

  it("sends JSON body and content-type on POST", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await api.post("/api/items", { name: "alpha" });

    expect(fetchMock).toHaveBeenCalledWith("/api/items", {
      method: "POST",
      body: JSON.stringify({ name: "alpha" }),
      headers: { "Content-Type": "application/json" },
    });
  });

  it("sends JSON body and content-type on PUT", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await api.put("/api/items/1", { name: "beta" });

    expect(fetchMock).toHaveBeenCalledWith("/api/items/1", {
      method: "PUT",
      body: JSON.stringify({ name: "beta" }),
      headers: { "Content-Type": "application/json" },
    });
  });

  it("throws ApiError with response body when request fails", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response("bad request", { status: 400, statusText: "Bad Request" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.get("/api/fail")).rejects.toEqual(new ApiError(400, "bad request"));
  });

  it("throws ApiError with statusText when response body is empty", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response("", { status: 500, statusText: "Internal Server Error" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.get("/api/fail")).rejects.toEqual(
      new ApiError(500, "Internal Server Error"),
    );
  });

  it("adds authorization header when VITE_HIVE_AUTH_TOKEN is configured", async () => {
    import.meta.env.VITE_HIVE_AUTH_TOKEN = "secret";
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await api.get("/api/projects");

    expect(fetchMock).toHaveBeenCalledWith("/api/projects", {
      headers: { Authorization: "Bearer secret" },
    });
  });
});
