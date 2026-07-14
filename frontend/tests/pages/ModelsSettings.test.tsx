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

beforeEach(() => {
  vi.clearAllMocks();
  __resetModelCatalogCacheForTests();
});

describe("ModelsSettings", () => {
  it("renders models grouped by provider with the current default checked", async () => {
    mocks.get.mockResolvedValue(MOCK_CATALOG);
    render(<ModelsSettings />);

    expect(await screen.findByText("Claude Code")).toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "GPT-5.5" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Opus 4.8" })).toHaveAttribute("aria-checked", "false");
  });

  it("saves the clicked model as the new default", async () => {
    mocks.get.mockResolvedValue(MOCK_CATALOG);
    mocks.put.mockResolvedValue({ defaultModelId: "claude:sonnet-5" });
    render(<ModelsSettings />);

    await userEvent.click(await screen.findByRole("radio", { name: "Sonnet 5" }));

    expect(mocks.put).toHaveBeenCalledWith("/api/settings/defaults", { defaultModelId: "claude:sonnet-5" });
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "Sonnet 5" })).toHaveAttribute("aria-checked", "true"),
    );
  });

  it("reverts the selection and shows an error when saving fails", async () => {
    mocks.get.mockResolvedValue(MOCK_CATALOG);
    mocks.put.mockRejectedValue(new Error("boom"));
    render(<ModelsSettings />);

    await userEvent.click(await screen.findByRole("radio", { name: "Sonnet 5" }));

    expect(await screen.findByText(/Could not save the default model/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "GPT-5.5" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Sonnet 5" })).toHaveAttribute("aria-checked", "false");
  });

  it("shows an empty state when no provider CLI is available", async () => {
    mocks.get.mockResolvedValue({ models: [], defaultModelId: "" });
    render(<ModelsSettings />);

    expect(await screen.findByText(/No agent CLI detected/)).toBeInTheDocument();
  });
});
