import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { FileContentToolbar } from "@/components/FileContentToolbar";

function renderToolbar(overrides?: Partial<ComponentProps<typeof FileContentToolbar>>) {
  const onModeChange = overrides?.onModeChange ?? vi.fn();
  const onDiffScopeChange = overrides?.onDiffScopeChange ?? vi.fn();
  const onDiffStyleChange = overrides?.onDiffStyleChange ?? vi.fn();
  const onPasteToPrompt = overrides?.onPasteToPrompt ?? vi.fn();

  render(
    <FileContentToolbar
      filePath="src/components/Button.tsx"
      mode="source"
      onModeChange={onModeChange}
      isModified
      diffScope="uncommitted"
      availableDiffScopes={["uncommitted"]}
      onDiffScopeChange={onDiffScopeChange}
      diffStyle="unified"
      onDiffStyleChange={onDiffStyleChange}
      commentCount={0}
      onPasteToPrompt={onPasteToPrompt}
      {...overrides}
    />,
  );

  return { onModeChange, onDiffScopeChange, onDiffStyleChange, onPasteToPrompt };
}

describe("FileContentToolbar", () => {
  it("renders directory and basename", () => {
    renderToolbar();
    expect(screen.getByText("src/components/")).toBeInTheDocument();
    expect(screen.getByText("Button.tsx")).toBeInTheDocument();
  });

  it("does not allow switching to diff when file is not modified", async () => {
    const user = userEvent.setup();
    const { onModeChange } = renderToolbar({ isModified: false });

    const diffButton = screen.getByRole("button", { name: "Diff" });
    expect(diffButton).toBeDisabled();
    await user.click(diffButton);

    expect(onModeChange).not.toHaveBeenCalled();
  });

  it("switches between source and diff modes", async () => {
    const user = userEvent.setup();
    const { onModeChange } = renderToolbar({ mode: "source", isModified: true });

    await user.click(screen.getByRole("button", { name: "Diff" }));
    await user.click(screen.getByRole("button", { name: "Source" }));

    expect(onModeChange).toHaveBeenNthCalledWith(1, "diff");
    expect(onModeChange).toHaveBeenNthCalledWith(2, "source");
  });

  it("allows the source tab label to describe previews", async () => {
    const user = userEvent.setup();
    const { onModeChange } = renderToolbar({ sourceLabel: "Preview" });

    await user.click(screen.getByRole("button", { name: "Preview" }));

    expect(onModeChange).toHaveBeenCalledWith("source");
  });

  it("shows diff controls in diff mode and forwards style changes", async () => {
    const user = userEvent.setup();
    const { onDiffStyleChange } = renderToolbar({
      mode: "diff",
      diffStyle: "split",
      commentCount: 0,
    });

    await user.click(screen.getByRole("button", { name: "Split" }));
    await user.click(screen.getByRole("button", { name: "Stacked" }));

    expect(onDiffStyleChange).toHaveBeenNthCalledWith(1, "split");
    expect(onDiffStyleChange).toHaveBeenNthCalledWith(2, "unified");
    expect(screen.queryByRole("button", { name: /Paste to prompt/i })).not.toBeInTheDocument();
  });

  it("hides text diff controls when the file only supports image preview fallback", () => {
    renderToolbar({
      mode: "diff",
      supportsTextDiff: false,
      availableDiffScopes: ["uncommitted", "committed", "combined"],
      commentCount: 2,
    });

    expect(screen.queryByRole("button", { name: "Split" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stacked" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Branch commits" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Paste to prompt/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Diff" })).toBeInTheDocument();
  });

  it("shows scope controls when more than one diff scope is available", async () => {
    const user = userEvent.setup();
    const { onDiffScopeChange } = renderToolbar({
      mode: "diff",
      diffScope: "uncommitted",
      availableDiffScopes: ["uncommitted", "committed", "combined"],
    });

    await user.click(screen.getByRole("button", { name: "Branch commits" }));
    await user.click(screen.getByRole("button", { name: "Combined" }));

    expect(onDiffScopeChange).toHaveBeenNthCalledWith(1, "committed");
    expect(onDiffScopeChange).toHaveBeenNthCalledWith(2, "combined");
  });

  it("shows paste button when comments exist and triggers callback", async () => {
    const user = userEvent.setup();
    const { onPasteToPrompt } = renderToolbar({
      mode: "diff",
      commentCount: 2,
    });

    await user.click(screen.getByRole("button", { name: "Paste to prompt (2)" }));
    expect(onPasteToPrompt).toHaveBeenCalledTimes(1);
  });
});
