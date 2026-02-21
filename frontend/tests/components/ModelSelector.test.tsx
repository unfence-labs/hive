import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModelSelector } from "@/components/chat/ModelSelector";
import type { ModelCatalogEntry } from "@/types";

const CLAUDE_MODELS: ModelCatalogEntry[] = [
  {
    id: "claude:opus-4-6",
    label: "Opus 4.6",
    provider: "claude",
    providerLabel: "Claude Code",
    isDefault: true,
    capabilities: { thinking: true, planMode: true, blockingTools: true },
  },
  {
    id: "claude:sonnet-4-6",
    label: "Sonnet 4.6",
    provider: "claude",
    providerLabel: "Claude Code",
    isNew: true,
    capabilities: { thinking: true, planMode: true, blockingTools: true },
  },
];

const CODEX_MODELS: ModelCatalogEntry[] = [
  {
    id: "codex:gpt-5.3-codex",
    label: "GPT-5.3-Codex",
    provider: "codex",
    providerLabel: "Codex",
    isDefault: true,
    capabilities: { thinking: "levels", planMode: false, blockingTools: false },
  },
];

const ALL_MODELS = [...CLAUDE_MODELS, ...CODEX_MODELS];

describe("ModelSelector", () => {
  it("displays selected model label", () => {
    render(
      <ModelSelector
        models={ALL_MODELS}
        selectedModelId="claude:opus-4-6"
        defaultModelId="claude:opus-4-6"
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("Opus 4.6")).toBeInTheDocument();
  });

  it("shows 'Select model' when selectedModelId does not match any model", () => {
    render(
      <ModelSelector
        models={ALL_MODELS}
        selectedModelId="nonexistent"
        defaultModelId="claude:opus-4-6"
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("Select model")).toBeInTheDocument();
  });

  it("opens dropdown and shows all models grouped by provider", async () => {
    const user = userEvent.setup();
    render(
      <ModelSelector
        models={ALL_MODELS}
        selectedModelId="claude:opus-4-6"
        defaultModelId="claude:opus-4-6"
        onSelect={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Model: Opus 4.6/i }));

    // Provider labels
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();

    // Model labels
    expect(screen.getByText("Sonnet 4.6")).toBeInTheDocument();
    expect(screen.getByText("GPT-5.3-Codex")).toBeInTheDocument();
  });

  it("shows NEW badge for models with isNew flag", async () => {
    const user = userEvent.setup();
    render(
      <ModelSelector
        models={ALL_MODELS}
        selectedModelId="claude:opus-4-6"
        defaultModelId="claude:opus-4-6"
        onSelect={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Model: Opus 4.6/i }));

    expect(screen.getByText("NEW")).toBeInTheDocument();
  });

  it("calls onSelect when a model is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ModelSelector
        models={ALL_MODELS}
        selectedModelId="claude:opus-4-6"
        defaultModelId="claude:opus-4-6"
        onSelect={onSelect}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Model: Opus 4.6/i }));
    await user.click(screen.getByText("Sonnet 4.6"));

    expect(onSelect).toHaveBeenCalledWith("claude:sonnet-4-6");
  });

  it("shows locked provider tooltip for disabled models", async () => {
    const user = userEvent.setup();
    render(
      <ModelSelector
        models={ALL_MODELS}
        selectedModelId="claude:opus-4-6"
        defaultModelId="claude:opus-4-6"
        onSelect={vi.fn()}
        lockedProvider="claude"
      />,
    );

    await user.click(screen.getByRole("button", { name: /Model: Opus 4.6/i }));

    // Codex models should be visually disabled (opacity-40, cursor-not-allowed)
    const codexModelElement = screen.getByText("GPT-5.3-Codex");
    const container = codexModelElement.closest("div");
    expect(container?.className).toContain("opacity-40");
    expect(container?.className).toContain("cursor-not-allowed");
  });

  it("does not call onSelect for locked provider models", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ModelSelector
        models={ALL_MODELS}
        selectedModelId="claude:opus-4-6"
        defaultModelId="claude:opus-4-6"
        onSelect={onSelect}
        lockedProvider="claude"
      />,
    );

    await user.click(screen.getByRole("button", { name: /Model: Opus 4.6/i }));

    // The codex model is rendered as a plain div (not a DropdownMenuItem),
    // so clicking it should NOT trigger onSelect
    const codexModelElement = screen.getByText("GPT-5.3-Codex");
    await user.click(codexModelElement);

    // Should not have been called with the codex model
    expect(onSelect).not.toHaveBeenCalledWith("codex:gpt-5.3-codex");
  });

  it("allows clicking same-provider models when provider is locked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ModelSelector
        models={ALL_MODELS}
        selectedModelId="claude:opus-4-6"
        defaultModelId="claude:opus-4-6"
        onSelect={onSelect}
        lockedProvider="claude"
      />,
    );

    await user.click(screen.getByRole("button", { name: /Model: Opus 4.6/i }));
    await user.click(screen.getByText("Sonnet 4.6"));

    expect(onSelect).toHaveBeenCalledWith("claude:sonnet-4-6");
  });

  it("does not lock any models when lockedProvider is undefined", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ModelSelector
        models={ALL_MODELS}
        selectedModelId="claude:opus-4-6"
        defaultModelId="claude:opus-4-6"
        onSelect={onSelect}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Model: Opus 4.6/i }));
    await user.click(screen.getByText("GPT-5.3-Codex"));

    expect(onSelect).toHaveBeenCalledWith("codex:gpt-5.3-codex");
  });

  it("has correct aria-label on trigger button", () => {
    render(
      <ModelSelector
        models={ALL_MODELS}
        selectedModelId="claude:sonnet-4-6"
        defaultModelId="claude:opus-4-6"
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /Model: Sonnet 4.6/i })).toBeInTheDocument();
  });
});
