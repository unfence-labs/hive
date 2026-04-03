import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useSessionMessages } from "@/hooks/useSessionMessages";
import { api } from "@/hooks/useApi";
import { createWrapper } from "../test-utils";

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: vi.fn(),
  },
}));

describe("useSessionMessages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty messages when sessionId is null", () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSessionMessages("ws-1", null), { wrapper });

    expect(result.current.messages).toEqual([]);
    expect(api.get).not.toHaveBeenCalled();
  });

  it("fetches messages for a valid sessionId", async () => {
    const messages = [
      { id: "m1", role: "user", content: "Hello", timestamp: 1 },
      { id: "m2", role: "assistant", content: "Hi", timestamp: 2 },
    ];
    vi.mocked(api.get).mockResolvedValue(messages);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSessionMessages("ws-1", "sess-1"), { wrapper });

    await waitFor(() => {
      expect(result.current.messages).toEqual(messages);
    });

    expect(api.get).toHaveBeenCalledWith("/api/workspaces/ws-1/sessions/sess-1/messages");
  });

  it("returns isLoading while fetching", () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {})); // never resolves

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSessionMessages("ws-1", "sess-1"), { wrapper });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.messages).toEqual([]);
  });

  it("returns empty messages on fetch error", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("Network error"));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSessionMessages("ws-1", "sess-1"), { wrapper });

    // After error, messages should still be empty array (fallback)
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.messages).toEqual([]);
  });
});
