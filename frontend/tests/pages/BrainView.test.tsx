import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BrainView from "@/pages/BrainView";

const mocks = vi.hoisted(() => ({
  useBrain: vi.fn(),
  useBrainFileTree: vi.fn(),
  useBrainFileContent: vi.fn(),
  useBrainFileMutations: vi.fn(),
  useBrainStatus: vi.fn(),
  useBrainDiff: vi.fn(),
  useBrainSave: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@/hooks/useBrain", () => ({ useBrain: mocks.useBrain }));
vi.mock("@/hooks/useBrainFiles", () => ({
  useBrainFileTree: mocks.useBrainFileTree,
  useBrainFileContent: mocks.useBrainFileContent,
  useBrainFileMutations: mocks.useBrainFileMutations,
}));
vi.mock("@/hooks/useBrainGit", () => ({
  useBrainStatus: mocks.useBrainStatus,
  useBrainDiff: mocks.useBrainDiff,
  useBrainSave: mocks.useBrainSave,
}));

// Keep the diff/editor lightweight in tests.
vi.mock("@/components/diff/FileDiffCard", () => ({
  FileDiffCard: ({ fileName }: { fileName: string }) => <div data-testid="diff-file">{fileName}</div>,
}));
vi.mock("@/components/ai-elements/message", () => ({
  MessageResponse: ({ children }: { children: string }) => <div>{children}</div>,
}));
vi.mock("@/components/MarkdownEditor", () => ({
  MarkdownEditor: () => <textarea data-testid="raw-editor" />,
}));
vi.mock("@pierre/diffs", () => ({
  parsePatchFiles: () => [
    { files: [{ name: "a.md", prevName: "", type: "modified", hunks: [] }] },
  ],
}));

describe("BrainView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useBrain.mockReturnValue({ brain: { exists: true, repoUrl: "x", createdAt: "" }, loading: false });
    mocks.useBrainFileTree.mockReturnValue({ data: [{ name: "a.md", path: "a.md", type: "file" }], error: null });
    mocks.useBrainFileContent.mockReturnValue({ data: { path: "a.md", content: "# A" }, isLoading: false });
    mocks.useBrainFileMutations.mockReturnValue({
      upsertFile: vi.fn(),
      deleteFile: vi.fn(),
      renameFile: vi.fn(),
    });
    mocks.useBrainStatus.mockReturnValue({ data: { files: [{ path: "a.md", status: "modified" }], count: 1 } });
    mocks.useBrainDiff.mockReturnValue({ data: { diff: "patch" }, isLoading: false, error: null });
    mocks.useBrainSave.mockReturnValue({ save: mocks.save, isSaving: false });
  });

  it("shows the not-connected state when no Brain exists", () => {
    mocks.useBrain.mockReturnValue({ brain: { exists: false }, loading: false });
    render(<BrainView />);
    expect(screen.getByText(/No Brain repository connected/i)).toBeInTheDocument();
  });

  it("renders the three-column layout with a collapsed chat placeholder", () => {
    render(<BrainView />);
    expect(screen.getByText(/Chat — coming in M-C/i)).toBeInTheDocument();
    expect(screen.getByText("Notes")).toBeInTheDocument();
  });

  it("switches to review mode on Save and runs save on confirm", async () => {
    const user = userEvent.setup();
    mocks.save.mockResolvedValue({ committed: true, pushed: true });
    render(<BrainView />);

    // Save button shows the pending badge count.
    const saveBtn = screen.getByRole("button", { name: /Save/i });
    expect(saveBtn).toHaveTextContent("1");
    await user.click(saveBtn);

    // Review panel appears with the diff.
    expect(await screen.findByText(/Review changes/i)).toBeInTheDocument();
    expect(screen.getByTestId("diff-file")).toHaveTextContent("a.md");

    // Confirm commits + pushes.
    await user.click(screen.getByRole("button", { name: /Save & Push/i }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(undefined));
  });

  it("returns to the editor when review is cancelled", async () => {
    const user = userEvent.setup();
    render(<BrainView />);

    await user.click(screen.getByRole("button", { name: /Save/i }));
    expect(await screen.findByText(/Review changes/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Cancel/i }));
    await waitFor(() => expect(screen.queryByText(/Review changes/i)).not.toBeInTheDocument());
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
