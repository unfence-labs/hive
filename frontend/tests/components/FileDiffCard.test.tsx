import { act, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileDiffMetadata } from "@pierre/diffs";
import { FileDiffCard } from "@/components/diff/FileDiffCard";

const mocks = vi.hoisted(() => ({
  getFiletypeFromFileName: vi.fn(() => "test-language"),
  preloadHighlighter: vi.fn(),
}));

vi.mock("@pierre/diffs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@pierre/diffs")>()),
  getFiletypeFromFileName: mocks.getFiletypeFromFileName,
  preloadHighlighter: mocks.preloadHighlighter,
}));

vi.mock("@pierre/diffs/react", () => ({
  FileDiff: () => <div data-testid="file-diff" />,
}));

const fileDiff = {
  type: "modified",
  name: "src/example.test-language",
  hunks: [{ hunkContent: ["@@ -1 +1 @@", "-before", "+after"] }],
} as FileDiffMetadata;

describe("FileDiffCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("waits for syntax highlighting before mounting Pierre in StrictMode", async () => {
    let resolvePreload: (() => void) | undefined;
    mocks.preloadHighlighter.mockReturnValue(
      new Promise<void>((resolve) => {
        resolvePreload = resolve;
      }),
    );

    render(
      <StrictMode>
        <FileDiffCard
          fileDiff={fileDiff}
          fileName="src/example.test-language"
          additions={1}
          deletions={1}
          themeType="light"
          diffStyle="unified"
        />
      </StrictMode>,
    );

    expect(screen.getByText("Loading diff...")).toBeInTheDocument();
    expect(screen.queryByTestId("file-diff")).not.toBeInTheDocument();
    expect(mocks.preloadHighlighter).toHaveBeenCalledWith({
      themes: ["github-dark", "github-light"],
      langs: ["test-language"],
    });

    await act(async () => resolvePreload?.());

    expect(await screen.findByTestId("file-diff")).toBeInTheDocument();
  });
});
