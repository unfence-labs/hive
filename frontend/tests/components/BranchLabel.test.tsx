import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BranchLabel } from "@/components/BranchLabel";

describe("BranchLabel", () => {
  it("renders branch name text", () => {
    render(<BranchLabel branch="workspace/tokyo" />);
    expect(screen.getByText("workspace/tokyo")).toBeDefined();
  });

  it("shows GitBranch SVG icon by default", () => {
    const { container } = render(<BranchLabel branch="main" />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("hides icon when showIcon={false}", () => {
    const { container } = render(<BranchLabel branch="main" showIcon={false} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("applies custom className", () => {
    const { container } = render(
      <BranchLabel branch="main" className="text-xs text-muted-foreground" />,
    );
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain("text-xs");
    expect(wrapper?.className).toContain("text-muted-foreground");
  });
});
