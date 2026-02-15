import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parsePatchFiles } from "@pierre/diffs";
import { GitDiffModal } from "@/components/diff/GitDiffModal";
import { api } from "@/hooks/useApi";

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: vi.fn(),
  },
}));

vi.mock("@/hooks/useThemeType", () => ({
  useThemeType: () => "light",
}));

vi.mock("@pierre/diffs", async (importOriginal) => {
  const original = await importOriginal<typeof import("@pierre/diffs")>();
  return {
    ...original,
    parsePatchFiles: vi.fn(),
  };
});

vi.mock("@pierre/diffs/react", () => ({
  FileDiff: ({ fileDiff, options, lineAnnotations }: any) => (
    <div>
      <div>{`FILEDIFF:${fileDiff.name ?? fileDiff.prevName ?? "unknown"}`}</div>
      <div>{`ANNOTATIONS:${lineAnnotations.length}`}</div>
      <button
        type="button"
        onClick={() =>
          options.onLineSelected?.({
            start: 3,
            end: 1,
            side: "additions",
          })
        }
      >
        Select Lines
      </button>
    </div>
  ),
}));

function makeParsedPatch(files: string[]) {
  return [
    {
      files: files.map((fileName) => ({
        name: fileName,
        type: "modified",
        hunks: [
          {
            additionCount: 7,
            additionLines: 2,
            deletionCount: 5,
            deletionLines: 0,
            hunkContent: ["@@ -1,5 +1,7 @@"],
          },
        ],
      })),
    },
  ] as never[];
}

describe("GitDiffModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads and renders parsed files", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ diff: "diff-text" });
    vi.mocked(parsePatchFiles).mockReturnValueOnce(
      makeParsedPatch(["src/a.ts"]),
    );

    render(
      <GitDiffModal open onOpenChange={() => {}} wsId="ws-1" />,
    );

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith("/api/workspaces/ws-1/diff");
    });

    expect(screen.getByText("1 file changed")).toBeInTheDocument();
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    expect(screen.getByText("FILEDIFF:src/a.ts")).toBeInTheDocument();
  });

  it("uses initialFile to preselect the matching file", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ diff: "diff-text" });
    vi.mocked(parsePatchFiles).mockReturnValueOnce(
      makeParsedPatch(["src/a.ts", "nested/b.ts"]),
    );

    render(
      <GitDiffModal
        open
        onOpenChange={() => {}}
        wsId="ws-1"
        initialFile="b.ts"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("FILEDIFF:nested/b.ts")).toBeInTheDocument();
    });
  });

  it("shows empty state when diff has no parseable files", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ diff: "non-empty-diff" });
    vi.mocked(parsePatchFiles).mockReturnValueOnce([]);

    render(<GitDiffModal open onOpenChange={() => {}} wsId="ws-1" />);

    await waitFor(() => {
      expect(screen.getByText("No changes to display")).toBeInTheDocument();
    });
  });

  it("displays stats from additionLines/deletionLines, not hunk span counts", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ diff: "diff-text" });
    vi.mocked(parsePatchFiles).mockReturnValueOnce(
      makeParsedPatch(["src/a.ts"]),
    );

    render(<GitDiffModal open onOpenChange={() => {}} wsId="ws-1" />);

    await waitFor(() => {
      expect(screen.getByText("a.ts")).toBeInTheDocument();
    });

    // Should show +2 (additionLines), NOT +7 (additionCount/hunk span)
    const additionElements = screen.getAllByText("+2");
    expect(additionElements.length).toBeGreaterThanOrEqual(1);
    // deletionLines is 0, so no deletion stat should be rendered
    expect(screen.queryByText("-5")).not.toBeInTheDocument();
    expect(screen.queryByText("+7")).not.toBeInTheDocument();
  });

  it("sums stats across multiple hunks in a single file", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ diff: "diff-text" });
    vi.mocked(parsePatchFiles).mockReturnValueOnce([
      {
        files: [
          {
            name: "src/big.ts",
            type: "modified",
            hunks: [
              {
                additionCount: 10,
                additionLines: 3,
                deletionCount: 5,
                deletionLines: 1,
                hunkContent: ["@@ -1,5 +1,10 @@"],
              },
              {
                additionCount: 8,
                additionLines: 4,
                deletionCount: 6,
                deletionLines: 2,
                hunkContent: ["@@ -20,6 +25,8 @@"],
              },
            ],
          },
        ],
      },
    ] as never[]);

    render(<GitDiffModal open onOpenChange={() => {}} wsId="ws-1" />);

    await waitFor(() => {
      expect(screen.getByText("big.ts")).toBeInTheDocument();
    });

    // Should show +7 (3+4 additionLines), -3 (1+2 deletionLines)
    const additions = screen.getAllByText("+7");
    expect(additions.length).toBeGreaterThanOrEqual(1);
    const deletions = screen.getAllByText("-3");
    expect(deletions.length).toBeGreaterThanOrEqual(1);

    // Must NOT show the span-based counts
    expect(screen.queryByText("+18")).not.toBeInTheDocument();
    expect(screen.queryByText("-11")).not.toBeInTheDocument();
  });

  it("shows deletion-only stats correctly", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ diff: "diff-text" });
    vi.mocked(parsePatchFiles).mockReturnValueOnce([
      {
        files: [
          {
            name: "src/removed.ts",
            type: "modified",
            hunks: [
              {
                additionCount: 3,
                additionLines: 0,
                deletionCount: 8,
                deletionLines: 5,
                hunkContent: ["@@ -1,8 +1,3 @@"],
              },
            ],
          },
        ],
      },
    ] as never[]);

    render(<GitDiffModal open onOpenChange={() => {}} wsId="ws-1" />);

    await waitFor(() => {
      expect(screen.getByText("removed.ts")).toBeInTheDocument();
    });

    // Should show -5 (deletionLines), no addition stat rendered
    const deletions = screen.getAllByText("-5");
    expect(deletions.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("+0")).not.toBeInTheDocument();
    expect(screen.queryByText("-8")).not.toBeInTheDocument();
  });

  it("computes correct totals across multiple files", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ diff: "diff-text" });
    vi.mocked(parsePatchFiles).mockReturnValueOnce([
      {
        files: [
          {
            name: "src/a.ts",
            type: "modified",
            hunks: [
              {
                additionCount: 10,
                additionLines: 3,
                deletionCount: 5,
                deletionLines: 1,
                hunkContent: ["@@ -1,5 +1,10 @@"],
              },
            ],
          },
          {
            name: "src/b.ts",
            type: "new",
            hunks: [
              {
                additionCount: 20,
                additionLines: 10,
                deletionCount: 0,
                deletionLines: 0,
                hunkContent: ["@@ -0,0 +1,20 @@"],
              },
            ],
          },
        ],
      },
    ] as never[]);

    render(<GitDiffModal open onOpenChange={() => {}} wsId="ws-1" />);

    await waitFor(() => {
      expect(screen.getByText("2 files changed")).toBeInTheDocument();
    });

    // Total: +13 (3+10), -1
    const totalAdditions = screen.getAllByText("+13");
    expect(totalAdditions.length).toBeGreaterThanOrEqual(1);
    const totalDeletions = screen.getAllByText("-1");
    expect(totalDeletions.length).toBeGreaterThanOrEqual(1);
  });

  it("shows error state when loading diff fails", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("fetch failed"));

    render(<GitDiffModal open onOpenChange={() => {}} wsId="ws-1" />);

    await waitFor(() => {
      expect(screen.getByText("fetch failed")).toBeInTheDocument();
    });
  });

  it("adds comments and sends them to the prompt callback", async () => {
    const user = userEvent.setup();
    const onAddToPrompt = vi.fn();
    const onOpenChange = vi.fn();
    vi.mocked(api.get).mockResolvedValueOnce({ diff: "diff-text" });
    vi.mocked(parsePatchFiles).mockReturnValueOnce(
      makeParsedPatch(["src/a.ts"]),
    );

    render(
      <GitDiffModal
        open
        onOpenChange={onOpenChange}
        wsId="ws-1"
        onAddToPrompt={onAddToPrompt}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("FILEDIFF:src/a.ts")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Select Lines" }));
    await user.type(
      screen.getByPlaceholderText("What should I do with this code?"),
      "Please clean this up",
    );
    await user.click(screen.getByRole("button", { name: "Add" }));

    await user.click(screen.getByRole("button", { name: /Send to prompt \(1\)/ }));

    expect(onAddToPrompt).toHaveBeenCalledWith(
      'In src/a.ts (lines 1-3, new code): "Please clean this up"',
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
