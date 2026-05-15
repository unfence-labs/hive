import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModelSelector } from "@/components/chat/ModelSelector";
import type { ModelCatalogEntry } from "@/types";

const CLAUDE_MODELS: ModelCatalogEntry[] = [
  {
    id: "claude:opus-4-7",
    label: "Opus 4.7",
    provider: "claude",
    providerLabel: "Claude Code",
    isDefault: true,
    capabilities: { thinkingLevels: ["low", "medium", "high", "xhigh", "max"], planMode: true, blockingTools: true, completions: true },
  },
  {
    id: "claude:sonnet-4-6",
    label: "Sonnet 4.6",
    provider: "claude",
    providerLabel: "Claude Code",
    capabilities: { thinkingLevels: ["low", "medium", "high", "xhigh", "max"], planMode: true, blockingTools: true, completions: true },
  },
];

const CODEX_MODELS: ModelCatalogEntry[] = [
  {
    id: "codex:gpt-5.5",
    label: "GPT-5.5",
    provider: "codex",
    providerLabel: "Codex",
    isDefault: true,
    capabilities: { thinkingLevels: ["none", "minimal", "low", "medium", "high", "xhigh"], planMode: false, blockingTools: false, completions: true },
  },
];

const GEMINI_MODELS: ModelCatalogEntry[] = [
  {
    id: "gemini:gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro",
    provider: "gemini",
    providerLabel: "Gemini CLI",
    isDefault: true,
    capabilities: { thinkingLevels: [], planMode: false, blockingTools: false, completions: false },
  },
];

const ALL_MODELS = [...CLAUDE_MODELS, ...CODEX_MODELS];

describe("ModelSelector", () => {
  it("displays selected model label", () => {
    render(
      <ModelSelector
        models={ALL_MODELS}
        selectedModelId="claude:opus-4-7"

        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("Opus 4.7")).toBeInTheDocument();
  });

  it("shows 'Select model' when selectedModelId does not match any model", () => {
    render(
      <ModelSelector
        models={ALL_MODELS}
        selectedModelId="nonexistent"

        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("Select model")).toBeInTheDocument();
  });

  it("opens dropdown and shows all models grouped by provider", async () => {
    const user = userEvent.setup();
    render(
      <ModelSelector
        models={[...ALL_MODELS, ...GEMINI_MODELS]}
        selectedModelId="claude:opus-4-7"

        onSelect={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Model: Opus 4.7/i }));

    // Provider labels
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("Gemini CLI")).toBeInTheDocument();

    // Model labels
    expect(screen.getByText("Sonnet 4.6")).toBeInTheDocument();
    expect(screen.getByText("GPT-5.5")).toBeInTheDocument();
    expect(screen.getByText("Gemini 3.1 Pro")).toBeInTheDocument();
  });

  it("shows NEW badge for models with isNew flag", async () => {
    const modelsWithNew: ModelCatalogEntry[] = [
      ...CLAUDE_MODELS,
      { ...CODEX_MODELS[0], isNew: true },
    ];
    const user = userEvent.setup();
    render(
      <ModelSelector
        models={modelsWithNew}
        selectedModelId="claude:opus-4-7"

        onSelect={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Model: Opus 4.7/i }));

    expect(screen.getByText("NEW")).toBeInTheDocument();
  });

  it("calls onSelect when a model is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ModelSelector
        models={ALL_MODELS}
        selectedModelId="claude:opus-4-7"

        onSelect={onSelect}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Model: Opus 4.7/i }));
    await user.click(screen.getByText("Sonnet 4.6"));

    expect(onSelect).toHaveBeenCalledWith("claude:sonnet-4-6");
  });

  it("shows locked provider tooltip for disabled models", async () => {
    const user = userEvent.setup();
    render(
      <ModelSelector
        models={ALL_MODELS}
        selectedModelId="claude:opus-4-7"

        onSelect={vi.fn()}
        lockedProvider="claude"
      />,
    );

    await user.click(screen.getByRole("button", { name: /Model: Opus 4.7/i }));

    // Codex models should be visually disabled (opacity-30, cursor-not-allowed)
    const codexModelElement = screen.getByText("GPT-5.5");
    const container = codexModelElement.closest("div");
    expect(container?.className).toContain("opacity-30");
    expect(container?.className).toContain("cursor-not-allowed");
  });

  it("does not call onSelect for locked provider models", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ModelSelector
        models={ALL_MODELS}
        selectedModelId="claude:opus-4-7"

        onSelect={onSelect}
        lockedProvider="claude"
      />,
    );

    await user.click(screen.getByRole("button", { name: /Model: Opus 4.7/i }));

    // The codex model is rendered as a plain div (not a DropdownMenuItem),
    // so clicking it should NOT trigger onSelect
    const codexModelElement = screen.getByText("GPT-5.5");
    await user.click(codexModelElement);

    // Should not have been called with the codex model
    expect(onSelect).not.toHaveBeenCalledWith("codex:gpt-5.5");
  });

  it("allows clicking same-provider models when provider is locked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ModelSelector
        models={ALL_MODELS}
        selectedModelId="claude:opus-4-7"

        onSelect={onSelect}
        lockedProvider="claude"
      />,
    );

    await user.click(screen.getByRole("button", { name: /Model: Opus 4.7/i }));
    await user.click(screen.getByText("Sonnet 4.6"));

    expect(onSelect).toHaveBeenCalledWith("claude:sonnet-4-6");
  });

  it("does not lock any models when lockedProvider is undefined", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ModelSelector
        models={ALL_MODELS}
        selectedModelId="claude:opus-4-7"

        onSelect={onSelect}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Model: Opus 4.7/i }));
    await user.click(screen.getByText("GPT-5.5"));

    expect(onSelect).toHaveBeenCalledWith("codex:gpt-5.5");
  });

  it("has correct aria-label on trigger button", () => {
    render(
      <ModelSelector
        models={ALL_MODELS}
        selectedModelId="claude:sonnet-4-6"

        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /Model: Sonnet 4.6/i })).toBeInTheDocument();
  });

  it("renders Gemini icon when Gemini is selected", () => {
    render(
      <ModelSelector
        models={[...ALL_MODELS, ...GEMINI_MODELS]}
        selectedModelId="gemini:gemini-3.1-pro-preview"

        onSelect={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: /Model: Gemini 3.1 Pro/i });
    const iconPath = trigger.querySelector("svg path")?.getAttribute("d");
    expect(iconPath).toContain("M12 0C12 6.627");
  });

  it("renders Anthropic asterisk icon for Claude", () => {
    render(
      <ModelSelector
        models={ALL_MODELS}
        selectedModelId="claude:opus-4-7"

        onSelect={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: /Model: Opus 4.7/i });
    const iconPath = trigger.querySelector("svg path")?.getAttribute("d");
    expect(iconPath).toContain("M177.888 112.776");
  });

  it("falls back to Claude icon when selected model is missing", () => {
    render(
      <ModelSelector
        models={[...ALL_MODELS, ...GEMINI_MODELS]}
        selectedModelId="missing:model"

        onSelect={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: /Model: Select model/i });
    const iconPath = trigger.querySelector("svg path")?.getAttribute("d");
    expect(iconPath).toContain("M177.888 112.776");
  });
});
