import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFileContent } from "@/hooks/useFileContent";
import { api } from "@/hooks/useApi";
import { createWrapper } from "../test-utils";

vi.mock("@/hooks/useApi", () => ({
  api: { get: vi.fn() },
}));

describe("useFileContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves the workspace endpoint for a regular workspace id", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ path: "src/app.ts", content: "code" });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useFileContent("ws-1", "src/app.ts"), { wrapper });

    await waitFor(() => expect(result.current.content).toBe("code"));
    expect(api.get).toHaveBeenCalledWith("/api/workspaces/ws-1/file?path=src%2Fapp.ts");
  });

  it("resolves the Brain endpoint when wsId is 'brain'", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ path: "notes/x.md", content: "hi" });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useFileContent("brain", "notes/x.md"), { wrapper });

    await waitFor(() => expect(result.current.content).toBe("hi"));
    expect(api.get).toHaveBeenCalledWith("/api/brain/file?path=notes%2Fx.md");
  });

  it("is disabled (no fetch) when wsId or filePath is missing", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useFileContent("ws-1", null), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(api.get).not.toHaveBeenCalled();
    expect(result.current.content).toBeUndefined();
  });

  it("surfaces fetch errors", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("boom"));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useFileContent("ws-1", "big.bin"), { wrapper });

    await waitFor(() => expect(result.current.error?.message).toBe("boom"));
  });
});
