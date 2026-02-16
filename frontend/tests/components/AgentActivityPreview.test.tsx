import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AgentActivityPreview from "@/components/chat/AgentActivityPreview";

describe("AgentActivityPreview", () => {
  it("renders an SVG with role='img' and aria-label='Agent thinking'", () => {
    render(<AgentActivityPreview />);
    const svg = screen.getByRole("img", { name: "Agent thinking" });
    expect(svg).toBeInTheDocument();
    expect(svg.tagName.toLowerCase()).toBe("svg");
  });

  it("renders 9 rect elements for the dot matrix", () => {
    const { container } = render(<AgentActivityPreview />);
    const rects = container.querySelectorAll("rect");
    expect(rects).toHaveLength(9);
  });

  it("uses 'large' size config by default (dot=4)", () => {
    const { container } = render(<AgentActivityPreview />);
    const svg = container.querySelector("svg")!;
    // large: dot=4, gap=1 → total = 4*3 + 1*2 = 14, pad=3 → width = 14+6 = 20
    expect(svg.getAttribute("width")).toBe("20");
    expect(svg.getAttribute("height")).toBe("20");
  });

  it("uses 'small' size config when size='small' (dot=3)", () => {
    const { container } = render(<AgentActivityPreview size="small" />);
    const svg = container.querySelector("svg")!;
    // small: dot=3, gap=1 → total = 3*3 + 1*2 = 11, pad=3 → width = 11+6 = 17
    expect(svg.getAttribute("width")).toBe("17");
    expect(svg.getAttribute("height")).toBe("17");
  });

  it("contains a glow filter definition", () => {
    const { container } = render(<AgentActivityPreview />);
    const filter = container.querySelector("filter#orbit-glow");
    expect(filter).toBeInTheDocument();
  });

  it("applies text-primary class to the SVG", () => {
    const { container } = render(<AgentActivityPreview />);
    const svg = container.querySelector("svg")!;
    expect(svg.classList.toString()).toContain("text-primary");
  });
});
