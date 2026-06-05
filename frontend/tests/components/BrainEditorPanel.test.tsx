import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BrainEditorPanel } from "@/components/brain/BrainEditorPanel";

vi.mock("@/components/ai-elements/message", () => ({
  MessageResponse: ({ children }: { children: string }) => (
    <div data-testid="rendered">{children}</div>
  ),
}));

vi.mock("@/components/MarkdownEditor", () => ({
  MarkdownEditor: ({ value, onChange }: { value: string; onChange?: (v: string) => void }) => (
    <textarea
      data-testid="raw-editor"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}));

function renderPanel(overrides: Partial<Parameters<typeof BrainEditorPanel>[0]> = {}) {
  const onWriteToDisk = vi.fn();
  const onRequestReview = vi.fn();
  render(
    <BrainEditorPanel
      filePath="notes/x.md"
      loadedContent="# Hello"
      isLoadingContent={false}
      pendingCount={0}
      saveIndicator="idle"
      onWriteToDisk={onWriteToDisk}
      onRequestReview={onRequestReview}
      {...overrides}
    />,
  );
  return { onWriteToDisk, onRequestReview };
}

describe("BrainEditorPanel", () => {
  it("renders markdown preview by default and toggles to raw", async () => {
    const user = userEvent.setup();
    renderPanel();

    expect(screen.getByTestId("rendered")).toHaveTextContent("# Hello");
    expect(screen.queryByTestId("raw-editor")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Raw/i }));
    expect(screen.getByTestId("raw-editor")).toBeInTheDocument();
  });

  it("disables Save when there are no pending changes", () => {
    renderPanel({ pendingCount: 0 });
    expect(screen.getByRole("button", { name: /Save/i })).toBeDisabled();
  });

  it("shows the pending count badge and triggers review on Save", async () => {
    const user = userEvent.setup();
    const { onRequestReview } = renderPanel({ pendingCount: 3 });

    const saveButton = screen.getByRole("button", { name: /Save/i });
    expect(saveButton).not.toBeDisabled();
    expect(saveButton).toHaveTextContent("3");

    await user.click(saveButton);
    expect(onRequestReview).toHaveBeenCalledTimes(1);
  });

  it("debounces disk writes when editing raw content", async () => {
    vi.useFakeTimers();
    try {
      const { onWriteToDisk } = renderPanel();

      // Switch to raw via fireEvent to avoid userEvent/fake-timer interplay.
      fireEvent.click(screen.getByRole("button", { name: /Raw/i }));
      const editor = screen.getByTestId("raw-editor");
      fireEvent.change(editor, { target: { value: "# Hello!" } });

      expect(onWriteToDisk).not.toHaveBeenCalled();
      vi.advanceTimersByTime(700);
      expect(onWriteToDisk).toHaveBeenCalledWith("notes/x.md", "# Hello!");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the push-failed indicator", () => {
    renderPanel({ saveIndicator: "push-failed" });
    expect(screen.getByText(/Push failed/i)).toBeInTheDocument();
  });
});
