import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModifiedFileList } from "@/components/diff/ModifiedFileList";
import type { DiffFileStat } from "@/types";

function stat(overrides: Partial<DiffFileStat>): DiffFileStat {
  return {
    file: "src/file.ts",
    additions: 0,
    deletions: 0,
    status: "modified",
    ...overrides,
  };
}

describe("ModifiedFileList", () => {
  it("renders empty state when there are no changes", () => {
    render(
      <ModifiedFileList
        committed={[]}
        uncommitted={[]}
        onFileClick={() => {}}
      />,
    );

    expect(screen.getByText("No changes.")).toBeInTheDocument();
  });

  it("renders committed/uncommitted sections and forwards file clicks", async () => {
    const user = userEvent.setup();
    const onFileClick = vi.fn();

    render(
      <ModifiedFileList
        committed={[
          stat({
            file: "src/committed.ts",
            additions: 3,
            deletions: 1,
            status: "modified",
          }),
        ]}
        uncommitted={[
          stat({
            file: "src/new-file.ts",
            additions: 5,
            status: "added",
          }),
          stat({
            file: "src/removed-file.ts",
            deletions: 2,
            status: "deleted",
          }),
        ]}
        onFileClick={onFileClick}
      />,
    );

    expect(screen.getByText("Uncommitted")).toBeInTheDocument();
    expect(screen.getByText("Committed")).toBeInTheDocument();
    expect(screen.getByText("new-file.ts")).toBeInTheDocument();
    expect(screen.getByText("removed-file.ts")).toBeInTheDocument();
    expect(screen.getByText("committed.ts")).toBeInTheDocument();
    expect(screen.getAllByText("+5").length).toBeGreaterThan(0);
    expect(screen.getAllByText("-2").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /new-file\.ts/i }));
    expect(onFileClick).toHaveBeenCalledWith("src/new-file.ts");
  });

  it("highlights the active file row", () => {
    render(
      <ModifiedFileList
        committed={[]}
        uncommitted={[
          stat({ file: "src/a.ts", additions: 1 }),
          stat({ file: "src/b.ts", additions: 2 }),
        ]}
        onFileClick={() => {}}
        activeFile="src/a.ts"
      />,
    );

    const aBtn = screen.getByRole("button", { name: /a\.ts/i });
    const bBtn = screen.getByRole("button", { name: /b\.ts/i });
    expect(aBtn.className).toContain("ring");
    expect(bBtn.className).not.toContain("ring");
  });
});
