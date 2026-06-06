import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWrapper } from "../test-utils";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: mocks.apiGet,
    post: mocks.apiPost,
    delete: mocks.apiDelete,
  },
}));

import { useBrain } from "@/hooks/useBrain";

describe("useBrain", () => {
  beforeEach(() => {
    mocks.apiGet.mockReset();
    mocks.apiPost.mockReset();
    mocks.apiDelete.mockReset();
    mocks.apiGet.mockResolvedValue({ exists: false });
  });

  it("loads the Brain state", async () => {
    mocks.apiGet.mockResolvedValueOnce({
      exists: true,
      repoUrl: "git@github.com:octocat/brain.git",
      createdAt: "2026-06-05T00:00:00.000Z",
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useBrain(), { wrapper });

    await waitFor(() => {
      expect(result.current.brain.exists).toBe(true);
    });

    expect(mocks.apiGet).toHaveBeenCalledWith("/api/brain");
    expect(result.current.brain).toEqual({
      exists: true,
      repoUrl: "git@github.com:octocat/brain.git",
      createdAt: "2026-06-05T00:00:00.000Z",
    });
  });

  it("creates, connects, and deletes through /api/brain", async () => {
    const created = {
      exists: true,
      repoUrl: "git@github.com:octocat/brain.git",
      createdAt: "2026-06-05T00:00:00.000Z",
    };
    const connected = {
      exists: true,
      repoUrl: "git@github.com:octocat/existing-brain.git",
      createdAt: "2026-06-05T01:00:00.000Z",
    };
    mocks.apiPost
      .mockResolvedValueOnce(created)
      .mockResolvedValueOnce(connected);
    mocks.apiGet
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce(created)
      .mockResolvedValueOnce(connected)
      .mockResolvedValueOnce({ exists: false });
    mocks.apiDelete.mockResolvedValue(undefined);
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useBrain(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.createBrain({ name: "brain" });
    });
    expect(mocks.apiPost).toHaveBeenCalledWith("/api/brain", {
      mode: "create",
      name: "brain",
    });
    await waitFor(() => {
      expect(result.current.brain).toEqual(created);
    });

    await act(async () => {
      await result.current.connectBrain({ url: "git@github.com:octocat/existing-brain.git" });
    });
    expect(mocks.apiPost).toHaveBeenCalledWith("/api/brain", {
      mode: "connect",
      url: "git@github.com:octocat/existing-brain.git",
    });
    await waitFor(() => {
      expect(result.current.brain).toEqual(connected);
    });

    await act(async () => {
      await result.current.deleteBrain();
    });
    expect(mocks.apiDelete).toHaveBeenCalledWith("/api/brain");
    await waitFor(() => {
      expect(result.current.brain).toEqual({ exists: false });
    });
  });
});
