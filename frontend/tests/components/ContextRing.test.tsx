import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ContextRing } from "@/components/chat/ContextRing";
import type { ContextUsageData } from "@/hooks/useContextUsage";

function makeUsage(overrides: Partial<ContextUsageData> = {}): ContextUsageData {
  return {
    inputTokens: null,
    outputTokens: null,
    contextWindow: null,
    usageFraction: null,
    ...overrides,
  };
}

describe("ContextRing", () => {
  it("renders nothing when usageFraction is null", () => {
    const { container } = render(<ContextRing usage={makeUsage()} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders an SVG ring when usageFraction is provided", () => {
    const { container } = render(
      <ContextRing usage={makeUsage({ usageFraction: 0.3, inputTokens: 60_000, contextWindow: 200_000 })} />,
    );
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("width")).toBe("16");
    expect(svg?.getAttribute("height")).toBe("16");
  });

  it("renders two circles (track + progress)", () => {
    const { container } = render(
      <ContextRing usage={makeUsage({ usageFraction: 0.5, inputTokens: 100_000, contextWindow: 200_000 })} />,
    );
    const circles = container.querySelectorAll("circle");
    expect(circles).toHaveLength(2);
  });

  it("uses green stroke for low usage", () => {
    const { container } = render(
      <ContextRing usage={makeUsage({ usageFraction: 0.2, inputTokens: 40_000, contextWindow: 200_000 })} />,
    );
    const circles = container.querySelectorAll("circle");
    // The progress circle is the second one
    expect(circles[1]?.getAttribute("stroke")).toBe("var(--success)");
  });

  it("uses yellow stroke for medium usage", () => {
    const { container } = render(
      <ContextRing usage={makeUsage({ usageFraction: 0.6, inputTokens: 120_000, contextWindow: 200_000 })} />,
    );
    const circles = container.querySelectorAll("circle");
    expect(circles[1]?.getAttribute("stroke")).toBe("var(--warning)");
  });

  it("uses red stroke for high usage", () => {
    const { container } = render(
      <ContextRing usage={makeUsage({ usageFraction: 0.9, inputTokens: 180_000, contextWindow: 200_000 })} />,
    );
    const circles = container.querySelectorAll("circle");
    expect(circles[1]?.getAttribute("stroke")).toBe("var(--destructive)");
  });

  it("renders at 0% usage fraction", () => {
    const { container } = render(
      <ContextRing usage={makeUsage({ usageFraction: 0, inputTokens: 0, contextWindow: 200_000 })} />,
    );
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
  });

  it("renders at 100% usage fraction", () => {
    const { container } = render(
      <ContextRing usage={makeUsage({ usageFraction: 1, inputTokens: 200_000, contextWindow: 200_000 })} />,
    );
    const circles = container.querySelectorAll("circle");
    // Red at 100%
    expect(circles[1]?.getAttribute("stroke")).toBe("var(--destructive)");
    // strokeDashoffset should be 0 at 100%
    const offset = circles[1]?.getAttribute("stroke-dashoffset");
    expect(Number(offset)).toBeCloseTo(0, 1);
  });

  it("applies tooltip trigger attributes to the SVG", () => {
    const { container } = render(
      <ContextRing usage={makeUsage({ usageFraction: 0.31, inputTokens: 62_000, contextWindow: 200_000 })} />,
    );
    const svg = container.querySelector("svg");
    // Radix tooltip trigger sets data-state attribute
    expect(svg?.getAttribute("data-state")).toBe("closed");
  });
});
