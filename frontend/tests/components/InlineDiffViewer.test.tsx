import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { createRef } from "react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  InlineDiffViewer,
  type InlineDiffViewerHandle,
} from "@/components/diff/InlineDiffViewer";

const mocks = vi.hoisted(() => ({
  useDiff: vi.fn(),
}));

vi.mock("@/hooks/useDiff", () => ({
  useDiff: mocks.useDiff,
}));

vi.mock("@/hooks/useThemeType", () => ({
  useThemeType: () => "light",
}));

vi.mock("@/components/FileViewer", () => ({
  FileViewer: ({ filePath }: { filePath: string }) => (
    <div data-testid="image-file-preview">{filePath}</div>
  ),
}));

vi.mock("nanoid", () => ({
  nanoid: () => "comment-id",
}));

vi.mock("@pierre/diffs/react", () => ({
  FileDiff: ({
    lineAnnotations,
    options,
    renderAnnotation,
  }: {
    lineAnnotations: Array<{
      side: "deletions" | "additions";
      lineNumber: number;
      metadata?: unknown;
    }>;
    options: {
      onLineSelected?: (range: {
        side?: "deletions" | "additions";
        start: number;
        end: number;
      } | null) => void;
    };
    renderAnnotation?: (annotation: {
      side: "deletions" | "additions";
      lineNumber: number;
      metadata?: unknown;
    }) => ReactNode;
  }) => (
    <div data-testid="mock-file-diff">
      <button
        type="button"
        onClick={() =>
          options.onLineSelected?.({ side: "additions", start: 10, end: 12 })
        }
      >
        select-added-lines
      </button>
      <button
        type="button"
        onClick={() =>
          options.onLineSelected?.({ side: "deletions", start: 5, end: 5 })
        }
      >
        select-old-line
      </button>
      {lineAnnotations.map((annotation) => (
        <div
          key={`${annotation.side}-${annotation.lineNumber}`}
          data-testid={`annotation-${annotation.side}-${annotation.lineNumber}`}
        >
          {renderAnnotation?.(annotation)}
        </div>
      ))}
    </div>
  ),
}));

const defaultParsedFiles = [
  {
    files: [
      {
        type: "modified",
        name: "src/a.ts",
        prevName: undefined,
        hunks: [
          {
            additionLines: 2,
            deletionLines: 1,
            hunkContent: ["@@ -1,1 +1,2 @@"],
          },
        ],
      },
    ],
  },
];

function renderViewer(
  overrides?: Partial<ComponentProps<typeof InlineDiffViewer>>,
) {
  const onCommentCountChange = overrides?.onCommentCountChange ?? vi.fn();
  const onPasteToPrompt = overrides?.onPasteToPrompt ?? vi.fn();

  render(
    <InlineDiffViewer
      wsId="ws-1"
      filePath="src/a.ts"
      diffScope="uncommitted"
      diffStyle="unified"
      onCommentCountChange={onCommentCountChange}
      onPasteToPrompt={onPasteToPrompt}
      {...overrides}
    />,
  );

  return { onCommentCountChange, onPasteToPrompt };
}

describe("InlineDiffViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useDiff.mockReturnValue({
      patchFiles: defaultParsedFiles,
      omittedFileCount: 0,
      loading: false,
      error: null,
    });
  });

  it("renders loading state while diff data is being fetched", () => {
    mocks.useDiff.mockReturnValue({
      patchFiles: [],
      omittedFileCount: 0,
      loading: true,
      error: null,
    });
    renderViewer();

    expect(screen.getByText("Loading diff...")).toBeInTheDocument();
  });

  it("renders an error state when diff fetch fails", () => {
    mocks.useDiff.mockReturnValue({
      patchFiles: [],
      omittedFileCount: 0,
      loading: false,
      error: "network failed",
    });
    renderViewer();

    expect(screen.getByText("network failed")).toBeInTheDocument();
  });

  it("renders empty state when the selected file has no changes", () => {
    renderViewer({ filePath: "src/missing.ts" });
    expect(screen.getByText("No changes for this file")).toBeInTheDocument();
  });

  it("warns when the selected file may be omitted from a capped diff", () => {
    mocks.useDiff.mockReturnValue({
      patchFiles: [],
      omittedFileCount: 2,
      loading: false,
      error: null,
    });

    renderViewer({ filePath: "notes/missing.md" });

    expect(screen.getByText(/not included in the rendered diff/i)).toBeInTheDocument();
    expect(screen.getByText(/2 untracked files were omitted/i)).toBeInTheDocument();
    expect(screen.queryByText("No changes for this file")).not.toBeInTheDocument();
  });

  it("matches file by basename and renders diff stats", () => {
    renderViewer({ filePath: "a.ts" });
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.getByText("-1")).toBeInTheDocument();
  });

  it("adds and removes comments while reporting comment count changes", async () => {
    const user = userEvent.setup();
    const { onCommentCountChange } = renderViewer();

    await waitFor(() => {
      expect(onCommentCountChange).toHaveBeenLastCalledWith(0);
    });

    await user.click(screen.getByRole("button", { name: "select-added-lines" }));
    await user.type(
      screen.getByPlaceholderText("What should I do with this code?"),
      "please refactor this block",
    );
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getAllByText("please refactor this block")).toHaveLength(3);
    await waitFor(() => {
      expect(onCommentCountChange).toHaveBeenLastCalledWith(1);
    });

    const firstAnnotation = screen.getByTestId("annotation-additions-10");
    await user.click(within(firstAnnotation).getByRole("button"));

    expect(screen.queryAllByText("please refactor this block")).toHaveLength(0);
    await waitFor(() => {
      expect(onCommentCountChange).toHaveBeenLastCalledWith(0);
    });
  });

  it("formats comment text and clears comments when pasteToPrompt is called", async () => {
    const user = userEvent.setup();
    const ref = createRef<InlineDiffViewerHandle>();
    const onPasteToPrompt = vi.fn();
    const onCommentCountChange = vi.fn();

    render(
      <InlineDiffViewer
        ref={ref}
        wsId="ws-1"
        filePath="src/a.ts"
        diffScope="uncommitted"
        diffStyle="unified"
        onCommentCountChange={onCommentCountChange}
        onPasteToPrompt={onPasteToPrompt}
      />,
    );

    await user.click(screen.getByRole("button", { name: "select-old-line" }));
    await user.type(
      screen.getByPlaceholderText("What should I do with this code?"),
      "remove deprecated branch",
    );
    await user.keyboard("{Enter}");

    expect(screen.getByText("remove deprecated branch")).toBeInTheDocument();

    act(() => {
      ref.current?.pasteToPrompt();
    });

    expect(onPasteToPrompt).toHaveBeenCalledWith(
      'In src/a.ts (line 5, old code): "remove deprecated branch"',
    );
    expect(screen.queryByText("remove deprecated branch")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(onCommentCountChange).toHaveBeenLastCalledWith(0);
    });
  });

  it("renders empty-file placeholder when the file has no hunk content", () => {
    mocks.useDiff.mockReturnValue({
      patchFiles: [
        {
          files: [
            {
              type: "modified",
              name: "src/a.ts",
              prevName: undefined,
              hunks: [
                {
                  additionLines: 0,
                  deletionLines: 0,
                  hunkContent: [],
                },
              ],
            },
          ],
        },
      ],
      omittedFileCount: 0,
      loading: false,
      error: null,
    });

    renderViewer();
    expect(screen.getByText("Empty file")).toBeInTheDocument();
  });

  it("renders an image diff fallback with the current image preview", () => {
    renderViewer({ filePath: "assets/logo.png" });

    expect(mocks.useDiff).toHaveBeenCalledWith("ws-1", "uncommitted", false);
    expect(
      screen.getByText("Image files do not have text diffs. Previewing the current file."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("image-file-preview")).toHaveTextContent("assets/logo.png");
    expect(screen.queryByText("Click on line numbers to select code and add comments")).not.toBeInTheDocument();
  });
});
