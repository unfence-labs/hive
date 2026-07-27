import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import { replaceConnection } from "@/hooks/useConnection";
import { createWrapper } from "../test-utils";

/** Route the probe and the env read separately, as the hook calls them. */
function mockServer(probe: Response | Error, health?: Response) {
  vi.mocked(fetch).mockImplementation((input) => {
    const url = String(input);
    if (url.endsWith("/health")) {
      return health ? Promise.resolve(health) : Promise.reject(new Error("no health"));
    }
    return probe instanceof Error ? Promise.reject(probe) : Promise.resolve(probe);
  });
}

function healthResponse(env: string): Response {
  return { ok: true, json: () => Promise.resolve({ status: "ok", env }) } as unknown as Response;
}

describe("useConnectionStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    localStorage.clear();
  });

  it("stays unknown and issues no request when no server is configured", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useConnectionStatus(), { wrapper });

    await waitFor(() => {
      expect(result.current.status).toBe("unknown");
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("becomes connected only when an authenticated endpoint accepts the token", async () => {
    replaceConnection({ host: "100.64.0.10", port: 3000, authToken: "tok" });
    mockServer(new Response("[]", { status: 200 }), healthResponse("development"));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useConnectionStatus(), { wrapper });

    await waitFor(() => {
      expect(result.current.status).toBe("connected");
    });
    expect(result.current.backendEnv).toBe("development");
    expect(fetch).toHaveBeenCalledWith(
      "http://100.64.0.10:3000/api/projects",
      expect.objectContaining({ headers: { Authorization: "Bearer tok" } }),
    );
  });

  it("reports a rejected token distinctly from an unreachable server", async () => {
    replaceConnection({ host: "100.64.0.10", port: 3000, authToken: "stale" });
    mockServer(new Response("", { status: 401 }), healthResponse("production"));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useConnectionStatus(), { wrapper });

    await waitFor(() => {
      expect(result.current.status).toBe("unauthorized");
    });
    expect(result.current.backendEnv).toBeNull();
  });

  it("does not report connected when only the unauthenticated health route answers", async () => {
    replaceConnection({ host: "100.64.0.10", port: 3000, authToken: "stale" });
    mockServer(new Response("", { status: 401 }), healthResponse("production"));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useConnectionStatus(), { wrapper });

    await waitFor(() => {
      expect(result.current.status).not.toBe("unknown");
    });
    expect(result.current.status).not.toBe("connected");
  });

  it("reports a refused client when the host guard answers 403", async () => {
    replaceConnection({ host: "100.64.0.10", port: 3000, authToken: "tok" });
    mockServer(new Response("", { status: 403 }));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useConnectionStatus(), { wrapper });

    await waitFor(() => {
      expect(result.current.status).toBe("forbidden");
    });
  });

  it("becomes disconnected when the request never lands", async () => {
    replaceConnection({ host: "100.64.0.10", port: 3000, authToken: "tok" });
    mockServer(new TypeError("Failed to fetch"));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useConnectionStatus(), { wrapper });

    await waitFor(() => {
      expect(result.current.status).toBe("disconnected");
    });
  });

  it("re-checks manually and updates status", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useConnectionStatus(), { wrapper });

    await waitFor(() => {
      expect(result.current.status).toBe("unknown");
    });
    expect(fetch).not.toHaveBeenCalled();

    replaceConnection({ host: "100.64.0.10", port: 3000, authToken: "tok" });
    mockServer(new Response("[]", { status: 200 }), healthResponse("production"));

    await act(async () => {
      await result.current.check();
    });

    await waitFor(() => {
      expect(result.current.status).toBe("connected");
    });
    expect(result.current.backendEnv).toBe("production");
  });
});
