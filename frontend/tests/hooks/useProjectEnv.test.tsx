import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { api } from "@/hooks/useApi";
import { useProjectEnv, useUpdateProjectEnv } from "@/hooks/useProjectEnv";
import { createWrapper } from "../test-utils";
import type { ProjectEnvConfig } from "@hive/shared/project-env";

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

describe("useProjectEnv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads project environment config", async () => {
    const config = envConfig("API_KEY", "secret");
    vi.mocked(api.get).mockResolvedValueOnce({
      exists: true,
      config,
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useProjectEnv("proj-1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.get).toHaveBeenCalledWith("/api/projects/proj-1/env");
    expect(result.current.data?.config).toEqual(config);
  });

  it("saves project environment config into the query cache", async () => {
    const config = envConfig("API_KEY", "updated");
    vi.mocked(api.put).mockResolvedValueOnce({
      exists: true,
      config,
    });

    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateProjectEnv("proj-1"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(config);
    });

    expect(api.put).toHaveBeenCalledWith("/api/projects/proj-1/env", {
      config,
    });
    expect(queryClient.getQueryData(["project-env", "proj-1"])).toEqual({
      exists: true,
      config,
    });
  });

});

function envConfig(key: string, value: string): ProjectEnvConfig {
  return {
    variables: [{ id: "var-1", key, value }],
  };
}
