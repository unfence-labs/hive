import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    expect(screen.getByText("Claude")).toBeInTheDocument();
  });

  it("renders nothing when every provider is unavailable", () => {
    mocks.useProviderUsage.mockReturnValue({
      data: {
        generatedAt: "2026-06-10T00:00:00.000Z",
        providers: [
          {
            id: "kimi",
            label: "Kimi",
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

  it("uses Kimi's most-consumed window in the compact bar and shows both windows", async () => {
    const user = userEvent.setup();
    mocks.useProviderUsage.mockReturnValue({
      data: {
        generatedAt: "2026-06-10T00:00:00.000Z",
        providers: [
          {
            id: "kimi",
            label: "Kimi",
            status: "available",
            lastUpdatedAt: "2026-06-10T00:00:00.000Z",
            buckets: [
              {
                id: "weekly",
                label: "Weekly",
                usedPercent: 38,
                windowDurationMins: 10_080,
                resetsAt: null,
              },
              {
                id: "five_hour",
                label: "5h",
                usedPercent: 72,
                windowDurationMins: 300,
                resetsAt: null,
              },
            ],
          },
        ],
      },
    });

    render(<ProviderUsage />);

    const label = screen.getByText("Kimi");
    const compactFill = label.nextElementSibling?.firstElementChild;
    expect(compactFill).toHaveStyle({ width: "72%" });

    await user.hover(label);
    expect(await screen.findAllByText("Kimi Weekly")).not.toHaveLength(0);
    expect(screen.getAllByText("Kimi 5h")).not.toHaveLength(0);
    expect(screen.getAllByText("38%")).not.toHaveLength(0);
    expect(screen.getAllByText("72%")).not.toHaveLength(0);
  });

  it("shows n/a and the explanatory message for unknown Kimi usage", async () => {
    const user = userEvent.setup();
    mocks.useProviderUsage.mockReturnValue({
      data: {
        generatedAt: "2026-06-10T00:00:00.000Z",
        providers: [
          {
            id: "kimi",
            label: "Kimi",
            status: "unknown",
            lastUpdatedAt: null,
            buckets: [],
            message: "Kimi usage API returned no weekly or 5-hour usage windows.",
          },
        ],
      },
    });

    render(<ProviderUsage />);

    await user.hover(screen.getByText("Kimi"));
    expect(await screen.findAllByText("n/a")).not.toHaveLength(0);
    expect(screen.getAllByText("Kimi usage API returned no weekly or 5-hour usage windows.")).not.toHaveLength(0);
  });

  it("shows Kimi errors without a stale compact bar", async () => {
    const user = userEvent.setup();
    mocks.useProviderUsage.mockReturnValue({
      data: {
        generatedAt: "2026-06-10T00:00:00.000Z",
        providers: [
          {
            id: "kimi",
            label: "Kimi",
            status: "error",
            lastUpdatedAt: null,
            buckets: [],
            message: "Invalid API key.",
          },
        ],
      },
    });

    render(<ProviderUsage />);

    const label = screen.getByText("Kimi");
    const compactFill = label.nextElementSibling?.firstElementChild;
    expect(compactFill).toHaveStyle({ width: "0%" });

    await user.hover(label);
    expect(await screen.findAllByText("Invalid API key.")).not.toHaveLength(0);
  });
});
