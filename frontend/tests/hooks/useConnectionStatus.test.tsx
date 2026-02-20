import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import { createWrapper } from "../test-utils";

const mocks = vi.hoisted(() => ({
  getServerUrl: vi.fn(),
}));

vi.mock("@/hooks/useServerUrl", () => ({
  getServerUrl: mocks.getServerUrl,
}));

describe("useConnectionStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    mocks.getServerUrl.mockReturnValue("");
  });

  it("stays unknown and does not call health endpoint when server URL is missing", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useConnectionStatus(), { wrapper });

    await waitFor(() => {
      expect(result.current.status).toBe("unknown");
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("becomes connected when health endpoint replies with ok=true", async () => {
    mocks.getServerUrl.mockReturnValue("http://100.64.0.10:3000");
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useConnectionStatus(), { wrapper });

    await waitFor(() => {
      expect(result.current.status).toBe("connected");
    });
    expect(fetch).toHaveBeenCalledWith(
      "http://100.64.0.10:3000/health",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("becomes disconnected when health endpoint replies with ok=false", async () => {
    mocks.getServerUrl.mockReturnValue("http://100.64.0.10:3000");
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useConnectionStatus(), { wrapper });

    await waitFor(() => {
      expect(result.current.status).toBe("disconnected");
    });
  });

  it("becomes disconnected when health request throws", async () => {
    mocks.getServerUrl.mockReturnValue("http://100.64.0.10:3000");
    vi.mocked(fetch).mockRejectedValue(new Error("network down"));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useConnectionStatus(), { wrapper });

    await waitFor(() => {
      expect(result.current.status).toBe("disconnected");
    });
  });

  it("re-checks manually and updates status", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useConnectionStatus(), { wrapper });

    // Wait for initial query to settle (resolves to "unknown" since server URL is empty)
    await waitFor(() => {
      expect(result.current.status).toBe("unknown");
    });
    expect(fetch).not.toHaveBeenCalled();

    mocks.getServerUrl.mockReturnValue("http://100.64.0.10:3000");
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);

    await act(async () => {
      await result.current.check();
    });

    await waitFor(() => {
      expect(result.current.status).toBe("connected");
    });
  });
});
