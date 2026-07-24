import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TeamSettings from "@/pages/settings/TeamSettings";
import { __resetModelCatalogCacheForTests, refreshModelCatalog } from "@/hooks/useModels";
import type { Agent, ModelCatalogResponse } from "@/types";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  useAgents: vi.fn(),
  useCreateAgent: vi.fn(),
  useUpdateAgent: vi.fn(),
  useDeleteAgent: vi.fn(),
  createMutateAsync: vi.fn(),
  updateMutateAsync: vi.fn(),
  deleteMutateAsync: vi.fn(),
}));

vi.mock("@/hooks/useApi", () => ({
  api: { get: mocks.apiGet },
}));

vi.mock("@/hooks/useAgents", () => ({
  useAgents: mocks.useAgents,
  useCreateAgent: mocks.useCreateAgent,
  useUpdateAgent: mocks.useUpdateAgent,
  useDeleteAgent: mocks.useDeleteAgent,
}));

vi.mock("@/components/AppLayout", () => ({
  SettingsHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-tauri-drag-region>{children}</div>
  ),
}));

vi.mock("@/components/PromptEditor", () => ({
  PromptEditor: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange?: (value: string) => void;
    placeholder?: string;
  }) => (
    <textarea
      aria-label="System Prompt"
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}));

const catalog: ModelCatalogResponse = {
  defaultModelId: "claude:sonnet-4-6",
  models: [
    {
      id: "claude:sonnet-4-6",
      label: "Sonnet 4.6",
      provider: "claude",
      providerLabel: "Claude Code",
      capabilities: {
        thinkingLevels: ["low", "medium", "high", "xhigh", "max"],
        planMode: true,
        blockingTools: true,
        completions: true,
        goals: false,
      },
    },
    {
      id: "codex:gpt-5.5",
      label: "GPT-5.5",
      provider: "codex",
      providerLabel: "Codex",
      capabilities: {
        thinkingLevels: ["none", "minimal", "low", "medium", "high", "xhigh"],
        planMode: false,
        blockingTools: false,
        completions: true,
        goals: false,
      },
    },
    {
      id: "kimi:k3",
      label: "K3",
      provider: "kimi",
      providerLabel: "Kimi",
      capabilities: {
        thinkingLevels: ["low", "high", "max"],
        planMode: true,
        blockingTools: true,
        completions: true,
        goals: false,
      },
    },
    {
      id: "kimi:kimi-for-coding",
      label: "K2.7 Coding",
      provider: "kimi",
      providerLabel: "Kimi",
      capabilities: {
        thinkingLevels: [],
        planMode: true,
        blockingTools: true,
        completions: true,
        goals: false,
      },
    },
  ],
};

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    name: "Code Auditor",
    systemPrompt: "You are a code auditor.",
    modelId: "claude:sonnet-4-6",
    thinkingLevel: "high",
    readOnly: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderPage(queryClient = createQueryClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <TeamSettings />
    </QueryClientProvider>,
  );
}

describe("TeamSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetModelCatalogCacheForTests();
    mocks.apiGet.mockResolvedValue(catalog);
    mocks.useAgents.mockReturnValue({ data: [], isLoading: false });
    mocks.useCreateAgent.mockReturnValue({
      mutateAsync: mocks.createMutateAsync,
      isPending: false,
    });
    mocks.useUpdateAgent.mockReturnValue({
      mutateAsync: mocks.updateMutateAsync,
      isPending: false,
    });
    mocks.useDeleteAgent.mockReturnValue({
      mutateAsync: mocks.deleteMutateAsync,
      isPending: false,
    });
    mocks.createMutateAsync.mockResolvedValue(makeAgent());
    mocks.updateMutateAsync.mockResolvedValue(makeAgent());
  });

  it("creates an agent with the selected thinking level", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Add Agent" }));
    await user.type(screen.getByPlaceholderText("e.g. Code Auditor"), "Security Reviewer");
    await user.type(screen.getByPlaceholderText("You are a code auditor..."), "Review safely.");

    await user.click(screen.getByRole("button", { name: "Extra high" }));
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(mocks.createMutateAsync).toHaveBeenCalledWith({
        name: "Security Reviewer",
        systemPrompt: "Review safely.",
        modelId: "claude:sonnet-4-6",
        thinkingLevel: "xhigh",
        readOnly: false,
      });
    });
  });

  it("resets an incompatible thinking level when the model changes", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Add Agent" }));
    await user.type(screen.getByPlaceholderText("e.g. Code Auditor"), "Security Reviewer");
    await user.type(screen.getByPlaceholderText("You are a code auditor..."), "Review safely.");

    const modelSelect = screen.getByRole("combobox");
    await user.click(screen.getByRole("button", { name: "Max" }));
    await user.selectOptions(modelSelect, "codex:gpt-5.5");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "High" })).toHaveAttribute("aria-pressed", "true"),
    );

    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(mocks.createMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: "codex:gpt-5.5",
          thinkingLevel: "high",
        }),
      );
    });
  });

  it("defaults K3 to high thinking", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Add Agent" }));
    await user.type(screen.getByPlaceholderText("e.g. Code Auditor"), "K3 Agent");
    await user.type(screen.getByPlaceholderText("You are a code auditor..."), "Do things.");
    await user.selectOptions(screen.getByRole("combobox"), "kimi:k3");

    expect(screen.getByRole("button", { name: "High" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(mocks.createMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: "kimi:k3",
          thinkingLevel: "high",
        }),
      );
    });
  });

  it("hides the thinking control and omits thinkingLevel for K2.7", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Add Agent" }));
    await user.type(screen.getByPlaceholderText("e.g. Code Auditor"), "Kimi Agent");
    await user.type(screen.getByPlaceholderText("You are a code auditor..."), "Do things.");

    expect(screen.getByText("Thinking")).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox"), "kimi:kimi-for-coding");
    await waitFor(() => expect(screen.queryByText("Thinking")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(mocks.createMutateAsync).toHaveBeenCalledWith({
        name: "Kimi Agent",
        systemPrompt: "Do things.",
        modelId: "kimi:kimi-for-coding",
        readOnly: false,
      });
    });
    expect(mocks.createMutateAsync.mock.calls[0][0]).not.toHaveProperty("thinkingLevel");
  });

  it("uses the refreshed model catalog after the Kimi key changes", async () => {
    const withoutKimi: ModelCatalogResponse = {
      ...catalog,
      models: catalog.models.filter((model) => model.provider !== "kimi"),
    };
    mocks.apiGet.mockResolvedValueOnce(withoutKimi).mockResolvedValueOnce(catalog);
    const queryClient = createQueryClient();

    const firstRender = renderPage(queryClient);
    await userEvent.click(screen.getByRole("button", { name: "Add Agent" }));
    await screen.findByRole("option", { name: "Sonnet 4.6 (Claude Code)" });
    expect(screen.queryByRole("option", { name: "K3 (Kimi)" })).not.toBeInTheDocument();
    firstRender.unmount();

    await act(() => refreshModelCatalog());
    renderPage(queryClient);
    await userEvent.click(screen.getByRole("button", { name: "Add Agent" }));

    expect(screen.getByRole("option", { name: "K3 (Kimi)" })).toBeInTheDocument();
  });
});
