import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActivityWave } from "@/components/ui/activity-wave";

describe("ActivityWave", () => {
  it("renders an SVG with role='img' and default aria-label", () => {
    render(<ActivityWave />);
    const svg = screen.getByRole("img", { name: "Agent thinking" });
    expect(svg).toBeInTheDocument();
    expect(svg.tagName.toLowerCase()).toBe("svg");
  });

  it("renders 3 rect bars", () => {
    const { container } = render(<ActivityWave />);
    expect(container.querySelectorAll("rect")).toHaveLength(3);
  });

  it("uses large size by default (size-4 class)", () => {
    const { container } = render(<ActivityWave />);
    const svg = container.querySelector("svg")!;
    expect(svg.className.baseVal).toContain("size-4");
  });

  it("uses small size when specified (size-3 class)", () => {
    const { container } = render(<ActivityWave />);
    expect(container.querySelector("svg")!.className.baseVal).toContain("size-4");

    const { container: small } = render(<ActivityWave size="small" />);
    expect(small.querySelector("svg")!.className.baseVal).toContain("size-3");
  });

  it("applies text-primary class", () => {
    const { container } = render(<ActivityWave />);
    expect(container.querySelector("svg")!.className.baseVal).toContain("text-primary");
  });

  it("passes custom className to the SVG", () => {
    const { container } = render(<ActivityWave className="my-custom" />);
    expect(container.querySelector("svg")!.className.baseVal).toContain("my-custom");
  });

  it("supports custom aria-label", () => {
    render(<ActivityWave label="Script running" />);
    expect(screen.getByRole("img", { name: "Script running" })).toBeInTheDocument();
  });

  it("renders as decorative (no role, aria-hidden)", () => {
    const { container } = render(<ActivityWave decorative />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("role")).toBeNull();
    expect(svg.getAttribute("aria-label")).toBeNull();
    expect(svg.getAttribute("aria-hidden")).toBe("true");
  });

  it("applies custom animation duration to each bar", () => {
    const { container } = render(<ActivityWave durationMs={2000} />);
    const rects = container.querySelectorAll("rect");
    for (const rect of rects) {
      expect(rect.style.animationDuration).toBe("2000ms");
    }
  });

  it("applies staggered animation delays to bars", () => {
    const { container } = render(<ActivityWave />);
    const rects = container.querySelectorAll("rect");
    const delays = Array.from(rects).map((r) => r.style.animationDelay);
    expect(delays).toEqual(["0s", "0.15s", "0.3s"]);
  });

  it("each bar has origin-bottom for bottom-anchored animation", () => {
    const { container } = render(<ActivityWave />);
    const rects = container.querySelectorAll("rect");
    for (const rect of rects) {
      expect(rect.className.baseVal).toContain("origin-bottom");
    }
  });

  it("uses default 1200ms duration", () => {
    const { container } = render(<ActivityWave />);
    const rects = container.querySelectorAll("rect");
    for (const rect of rects) {
      expect(rect.style.animationDuration).toBe("1200ms");
    }
  });

  it("has viewBox 0 0 12 12", () => {
    const { container } = render(<ActivityWave />);
    expect(container.querySelector("svg")!.getAttribute("viewBox")).toBe("0 0 12 12");
  });
});
