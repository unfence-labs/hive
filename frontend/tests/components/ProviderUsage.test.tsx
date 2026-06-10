import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProviderUsage } from "@/components/ProviderUsage";

const mocks = vi.hoisted(() => ({
  useProviderUsage: vi.fn(),
}));

vi.mock("@/hooks/useProviderUsage", () => ({
  useProviderUsage: mocks.useProviderUsage,
}));

describe("ProviderUsage", () => {
  it("renders compact usage rows for available providers", () => {
    mocks.useProviderUsage.mockReturnValue({
      data: {
        generatedAt: "2026-06-10T00:00:00.000Z",
        providers: [
          {
            id: "codex",
            label: "Codex",
            status: "available",
            lastUpdatedAt: "2026-06-10T00:00:00.000Z",
            buckets: [{
              id: "codex",
              label: null,
              usedPercent: 42,
              windowDurationMins: 60,
              resetsAt: 1780000000,
            }],
          },
          {
            id: "claude",
            label: "Claude Code",
            status: "unknown",
            lastUpdatedAt: null,
            buckets: [],
            message: "Claude Code OAuth credentials were not found. Run `claude auth login`.",
          },
        ],
      },
    });

    render(<ProviderUsage />);

    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByText("Claude")).toBeInTheDocument();
    expect(screen.getByText("n/a")).toBeInTheDocument();
  });

  it("renders nothing when every provider is unavailable", () => {
    mocks.useProviderUsage.mockReturnValue({
      data: {
        generatedAt: "2026-06-10T00:00:00.000Z",
        providers: [
          {
            id: "codex",
            label: "Codex",
            status: "unavailable",
            lastUpdatedAt: null,
            buckets: [],
          },
        ],
      },
    });

    const { container } = render(<ProviderUsage />);

    expect(container).toBeEmptyDOMElement();
  });
});
