import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrainReviewChanges } from "@/components/brain/BrainReviewChanges";

const mocks = vi.hoisted(() => ({ useBrainDiff: vi.fn() }));

vi.mock("@/hooks/useBrainGit", () => ({ useBrainDiff: mocks.useBrainDiff }));
vi.mock("@/hooks/useThemeType", () => ({ useThemeType: () => "dark" }));
vi.mock("@/components/diff/FileDiffCard", () => ({
  FileDiffCard: ({ fileName }: { fileName: string }) => <div data-testid="diff-file">{fileName}</div>,
}));
vi.mock("@pierre/diffs", () => ({
  parsePatchFiles: () => [
    { files: [{ name: "a.md", prevName: "", hunks: [] }] },
  ],
}));

function renderReview() {
  render(<BrainReviewChanges onConfirm={vi.fn()} onCancel={vi.fn()} isSaving={false} />);
}

describe("BrainReviewChanges omission warning", () => {
  beforeEach(() => vi.clearAllMocks());

  it("warns when files are omitted from the diff", () => {
    mocks.useBrainDiff.mockReturnValue({
      data: { diff: "patch", omittedFileCount: 7 },
      isLoading: false,
      error: null,
    });
    renderReview();

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/7 more files not shown/i);
    expect(alert).toHaveTextContent(/will still be committed/i);
  });

  it("does not warn when nothing is omitted", () => {
    mocks.useBrainDiff.mockReturnValue({
      data: { diff: "patch", omittedFileCount: 0 },
      isLoading: false,
      error: null,
    });
    renderReview();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("singularizes the warning for a single omitted file", () => {
    mocks.useBrainDiff.mockReturnValue({
      data: { diff: "patch", omittedFileCount: 1 },
      isLoading: false,
      error: null,
    });
    renderReview();

    expect(screen.getByRole("alert")).toHaveTextContent(/1 more file not shown/i);
  });
});
