import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  useAutomations,
  useAutomation,
  useAutomationRuns,
  useCreateAutomation,
  useUpdateAutomation,
  useDeleteAutomation,
  useTriggerAutomation,
} from "@/hooks/useAutomations";
import { api } from "@/hooks/useApi";
import type { Automation, AutomationRun } from "@/types";
import { createWrapper } from "../test-utils";

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: "auto-1",
    name: "Test Auto",
    enabled: true,
    trigger: { type: "cron", expression: "0 * * * *" },
    action: { type: "agent", modelId: "claude:opus-4-6", userPromptInline: "Do something" },
    notification: { onComplete: true, onFailure: true },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeRun(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: "run-1",
    automationId: "auto-1",
    status: "success",
    sessionId: "sess-1",
    startedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useAutomations", () => {
  it("fetches the automation list from the API", async () => {
    const automations = [makeAutomation(), makeAutomation({ id: "auto-2", name: "Second" })];
    vi.mocked(api.get).mockResolvedValueOnce(automations);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useAutomations(), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual(automations);
    });

    expect(api.get).toHaveBeenCalledWith("/api/automations");
  });

  it("returns undefined while loading", () => {
    vi.mocked(api.get).mockReturnValueOnce(new Promise(() => {}));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useAutomations(), { wrapper });

    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(true);
  });
});

describe("useAutomation", () => {
  it("fetches a single automation by ID", async () => {
    const auto = makeAutomation();
    vi.mocked(api.get).mockResolvedValueOnce(auto);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useAutomation("auto-1"), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual(auto);
    });

    expect(api.get).toHaveBeenCalledWith("/api/automations/auto-1");
  });

  it("does not fetch when id is undefined", () => {
    const { wrapper } = createWrapper();
    renderHook(() => useAutomation(undefined), { wrapper });

    expect(api.get).not.toHaveBeenCalled();
  });
});

describe("useAutomationRuns", () => {
  it("fetches runs for a specific automation", async () => {
    const runs = [makeRun(), makeRun({ id: "run-2" })];
    vi.mocked(api.get).mockResolvedValueOnce(runs);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useAutomationRuns("auto-1"), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual(runs);
    });

    expect(api.get).toHaveBeenCalledWith("/api/automations/auto-1/runs");
  });

  it("does not fetch when id is undefined", () => {
    const { wrapper } = createWrapper();
    renderHook(() => useAutomationRuns(undefined), { wrapper });

    expect(api.get).not.toHaveBeenCalled();
  });
});

describe("useCreateAutomation", () => {
  it("posts to the automations endpoint", async () => {
    const created = makeAutomation();
    vi.mocked(api.post).mockResolvedValueOnce(created);

    const { wrapper, queryClient } = createWrapper();
    const { result } = renderHook(() => useCreateAutomation(), { wrapper });

    const payload = {
      name: "Test Auto",
      trigger: { type: "cron" as const, expression: "0 * * * *" },
      action: { type: "agent" as const, modelId: "claude:opus-4-6", userPromptInline: "Do something" },
    };

    await act(async () => {
      await result.current.mutateAsync(payload);
    });

    expect(api.post).toHaveBeenCalledWith("/api/automations", payload);
  });

  it("invalidates automations query on success", async () => {
    vi.mocked(api.post).mockResolvedValueOnce(makeAutomation());

    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateAutomation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        name: "Test",
        trigger: { type: "cron" as const, expression: "0 * * * *" },
        action: { type: "agent" as const, modelId: "m", userPromptInline: "t" },
      });
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["automations"] }),
    );
  });
});

describe("useUpdateAutomation", () => {
  it("puts to the correct endpoint", async () => {
    vi.mocked(api.put).mockResolvedValueOnce(makeAutomation({ enabled: false }));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateAutomation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: "auto-1", enabled: false });
    });

    expect(api.put).toHaveBeenCalledWith("/api/automations/auto-1", { enabled: false });
  });

  it("invalidates automations query on success", async () => {
    vi.mocked(api.put).mockResolvedValueOnce(makeAutomation());

    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUpdateAutomation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: "auto-1", name: "Renamed" });
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["automations"] }),
    );
  });
});

describe("useDeleteAutomation", () => {
  it("sends DELETE to the correct endpoint", async () => {
    vi.mocked(api.delete).mockResolvedValueOnce(undefined);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteAutomation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync("auto-1");
    });

    expect(api.delete).toHaveBeenCalledWith("/api/automations/auto-1");
  });

  it("invalidates automations query on success", async () => {
    vi.mocked(api.delete).mockResolvedValueOnce(undefined);

    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useDeleteAutomation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync("auto-1");
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["automations"] }),
    );
  });
});

describe("useTriggerAutomation", () => {
  it("posts to the trigger endpoint", async () => {
    const run = makeRun();
    vi.mocked(api.post).mockResolvedValueOnce(run);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useTriggerAutomation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync("auto-1");
    });

    expect(api.post).toHaveBeenCalledWith("/api/automations/auto-1/trigger");
  });

  it("invalidates both automations and runs queries on success", async () => {
    vi.mocked(api.post).mockResolvedValueOnce(makeRun());

    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useTriggerAutomation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync("auto-1");
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["automation-runs", "auto-1"] }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["automations"] }),
    );
  });
});
