import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrainWelcome } from "@/components/BrainWelcome";

describe("BrainWelcome", () => {
  it("renders the headline and a pluralized notes count", () => {
    render(<BrainWelcome notesCount={1234} />);

    expect(screen.getByText(/personal knowledge base/i)).toBeInTheDocument();
    // toLocaleString inserts a separator for thousands.
    expect(screen.getByText("1,234")).toBeInTheDocument();
    expect(screen.getByText(/notes so far/i)).toBeInTheDocument();
  });

  it("uses the singular form for a single note", () => {
    render(<BrainWelcome notesCount={1} />);
    expect(screen.getByText(/note so far/i)).toBeInTheDocument();
  });

  it("shows a friendly empty message when there are no notes", () => {
    render(<BrainWelcome notesCount={0} />);
    expect(screen.getByText(/No notes yet/i)).toBeInTheDocument();
  });

  it("renders the repo url row only when provided", () => {
    const { rerender } = render(<BrainWelcome notesCount={3} />);
    expect(
      screen.queryByText("https://github.com/me/brain.git"),
    ).not.toBeInTheDocument();

    rerender(
      <BrainWelcome notesCount={3} repoUrl="https://github.com/me/brain.git" />,
    );
    expect(
      screen.getByText("https://github.com/me/brain.git"),
    ).toBeInTheDocument();
  });
});
