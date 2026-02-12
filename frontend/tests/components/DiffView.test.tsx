import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DiffView } from "@/components/diff/DiffView";

describe("DiffView", () => {
  it("renders path and highlights added/removed lines", () => {
    render(
      <DiffView
        filePath="src/example.ts"
        oldText={"keep\nremove-this\n"}
        newText={"keep\nadd-this\n"}
        className="custom-class"
      />,
    );

    expect(screen.getByText("Path: src/example.ts")).toBeInTheDocument();

    const removed = screen.getByText("remove-this");
    const added = screen.getByText("add-this");
    expect(removed.closest("div")).toHaveClass("text-red-400");
    expect(added.closest("div")).toHaveClass("text-green-400");
  });

  it("renders without file path metadata", () => {
    render(<DiffView oldText={"a\n"} newText={"b\n"} />);

    expect(screen.queryByText(/^Path:/)).not.toBeInTheDocument();
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("b")).toBeInTheDocument();
  });
});
