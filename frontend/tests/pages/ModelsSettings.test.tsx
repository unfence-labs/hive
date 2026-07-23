import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ModelsSettings from "@/pages/settings/ModelsSettings";
import { __resetModelCatalogCacheForTests } from "@/hooks/useModels";
import type { ModelCatalogResponse } from "@/types";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
}));

vi.mock("@/hooks/useApi", () => ({
  api: { get: mocks.get, put: mocks.put },
}));

vi.mock("@/components/AppLayout", () => ({
  SettingsHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-tauri-drag-region>{children}</div>
  ),
}));

const CAPABILITIES = {
  thinkingLevels: ["low", "medium", "high"],
  planMode: true,
  blockingTools: true,
  completions: true,
  goals: false,
} as const;

const MOCK_CATALOG: ModelCatalogResponse = {
  models: [
    { id: "claude:opus-4-8", label: "Opus 4.8", provider: "claude", providerLabel: "Claude Code", isDefault: true, capabilities: { ...CAPABILITIES } },
    { id: "claude:sonnet-5", label: "Sonnet 5", provider: "claude", providerLabel: "Claude Code", capabilities: { ...CAPABILITIES } },
    { id: "codex:gpt-5.5", label: "GPT-5.5", provider: "codex", providerLabel: "Codex", isDefault: true, capabilities: { ...CAPABILITIES } },
  ],
  defaultModelId: "codex:gpt-5.5",
};

function mockApiGet(catalog: unknown, kimi: { apiKey: string } = { apiKey: "" }) {
  mocks.get.mockImplementation((url: string) =>
    url === "/api/settings/kimi" ? Promise.resolve(kimi) : Promise.resolve(catalog),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetModelCatalogCacheForTests();
});

describe("ModelsSettings", () => {
  it("renders models grouped by provider with the current default checked", async () => {
    mockApiGet(MOCK_CATALOG);
    render(<ModelsSettings />);

    expect(await screen.findByText("Claude Code")).toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "GPT-5.5" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Opus 4.8" })).toHaveAttribute("aria-checked", "false");
  });

  it("saves the clicked model as the new default", async () => {
    mockApiGet(MOCK_CATALOG);
    mocks.put.mockResolvedValue({ defaultModelId: "claude:sonnet-5" });
    render(<ModelsSettings />);

    await userEvent.click(await screen.findByRole("radio", { name: "Sonnet 5" }));

    expect(mocks.put).toHaveBeenCalledWith("/api/settings/defaults", { defaultModelId: "claude:sonnet-5" });
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "Sonnet 5" })).toHaveAttribute("aria-checked", "true"),
    );
  });

  it("reverts the selection and shows an error when saving fails", async () => {
    mockApiGet(MOCK_CATALOG);
    mocks.put.mockRejectedValue(new Error("boom"));
    render(<ModelsSettings />);

    await userEvent.click(await screen.findByRole("radio", { name: "Sonnet 5" }));

    expect(await screen.findByText(/Could not save the default model/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "GPT-5.5" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Sonnet 5" })).toHaveAttribute("aria-checked", "false");
  });

  it("shows an empty state when no provider CLI is available", async () => {
    mockApiGet({ models: [], defaultModelId: "" });
    render(<ModelsSettings />);

    expect(await screen.findByText(/No agent CLI detected/)).toBeInTheDocument();
  });

  it("loads the saved Kimi API key into the input", async () => {
    mockApiGet(MOCK_CATALOG, { apiKey: "sk-kimi-key" });
    render(<ModelsSettings />);

    await waitFor(() =>
      expect(screen.getByLabelText("Kimi API key")).toHaveValue("sk-kimi-key"),
    );
  });

  it("saves the Kimi API key and shows confirmation", async () => {
    mockApiGet(MOCK_CATALOG);
    mocks.put.mockResolvedValue({ apiKey: "sk-new-key" });
    render(<ModelsSettings />);

    await userEvent.type(await screen.findByLabelText("Kimi API key"), "sk-new-key");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(mocks.put).toHaveBeenCalledWith("/api/settings/kimi", { apiKey: "sk-new-key" });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("refetches the model catalog after saving the Kimi key", async () => {
    let catalog: ModelCatalogResponse = MOCK_CATALOG;
    mocks.get.mockImplementation((url: string) =>
      url === "/api/settings/kimi" ? Promise.resolve({ apiKey: "" }) : Promise.resolve(catalog),
    );
    // The saved key enables Kimi server-side: the refetched catalog includes it.
    mocks.put.mockImplementation(async () => {
      catalog = {
        ...MOCK_CATALOG,
        models: [
          ...MOCK_CATALOG.models,
          { id: "kimi:k3", label: "K3", provider: "kimi", providerLabel: "Kimi", capabilities: { ...CAPABILITIES, thinkingLevels: ["low", "high", "max"] } },
        ],
      };
      return { apiKey: "sk-new-key" };
    });
    render(<ModelsSettings />);

    expect(await screen.findByText("Claude Code")).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "K3" })).not.toBeInTheDocument();

    await userEvent.type(await screen.findByLabelText("Kimi API key"), "sk-new-key");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("radio", { name: "K3" })).toBeInTheDocument();
    const catalogFetches = mocks.get.mock.calls.filter(([url]) => url === "/api/models");
    expect(catalogFetches).toHaveLength(2);
  });

  it("shows an error when saving the Kimi API key fails", async () => {
    mockApiGet(MOCK_CATALOG);
    mocks.put.mockRejectedValue(new Error("boom"));
    render(<ModelsSettings />);

    await userEvent.type(await screen.findByLabelText("Kimi API key"), "sk-new-key");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Failed to save")).toBeInTheDocument();
  });

  it("hides the Kimi form until the saved key has loaded", async () => {
    let resolveKimi!: (value: { apiKey: string }) => void;
    mocks.get.mockImplementation((url: string) =>
      url === "/api/settings/kimi"
        ? new Promise<{ apiKey: string }>((resolve) => { resolveKimi = resolve; })
        : Promise.resolve(MOCK_CATALOG),
    );
    render(<ModelsSettings />);

    expect(await screen.findByText("Loading saved key…")).toBeInTheDocument();
    expect(screen.queryByLabelText("Kimi API key")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();

    resolveKimi({ apiKey: "sk-stored" });

    expect(await screen.findByLabelText("Kimi API key")).toHaveValue("sk-stored");
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("does not offer Save (which could wipe the stored key) when the load fails", async () => {
    mocks.get.mockImplementation((url: string) =>
      url === "/api/settings/kimi"
        ? Promise.reject(new Error("boom"))
        : Promise.resolve(MOCK_CATALOG),
    );
    render(<ModelsSettings />);

    expect(await screen.findByText(/Could not load the saved API key/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Kimi API key")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(mocks.put).not.toHaveBeenCalled();
  });
});
