import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrStatusSection } from "@/components/PrStatusSection";
import type { PullRequestInfo } from "@/types";

vi.mock("@/hooks/usePrStatus", () => ({
  usePrStatus: vi.fn(),
}));

import { usePrStatus } from "@/hooks/usePrStatus";
const mockUsePrStatus = vi.mocked(usePrStatus);

function makePr(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    number: 42,
    url: "https://github.com/acme/widget/pull/42",
    state: "open",
    mergeable: null,
    mergeableState: "unknown",
    checksStatus: "success",
    checksPassed: null,
    checksTotal: null,
    reviewStatus: null,
    ...overrides,
  };
}

describe("PrStatusSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows 'Checking…' while loading", () => {
    mockUsePrStatus.mockReturnValue({ pr: null, error: null, loading: true });
    render(<PrStatusSection wsId="ws-1" />);
    expect(screen.getByText(/Checking/)).toBeDefined();
  });

  it("shows 'No pull request' when no wsId is provided", () => {
    mockUsePrStatus.mockReturnValue({ pr: null, error: null, loading: false });
    render(<PrStatusSection />);
    expect(screen.getByText("No pull request")).toBeDefined();
  });

  it("shows 'No pull request' when PR is null", () => {
    mockUsePrStatus.mockReturnValue({ pr: null, error: null, loading: false });
    render(<PrStatusSection wsId="ws-1" />);
    expect(screen.getByText("No pull request")).toBeDefined();
  });

  it("shows error message when error is set", () => {
    mockUsePrStatus.mockReturnValue({ pr: null, error: "gh CLI not installed", loading: false });
    render(<PrStatusSection wsId="ws-1" />);
    expect(screen.getByText("gh CLI not installed")).toBeDefined();
  });

  it("prioritizes error over missing PR (shows error, not 'No pull request')", () => {
    mockUsePrStatus.mockReturnValue({
      pr: null,
      error: "gh not authenticated — run `gh auth login`",
      loading: false,
    });
    render(<PrStatusSection wsId="ws-1" />);
    expect(screen.getByText(/gh not authenticated/)).toBeDefined();
    expect(screen.queryByText("No pull request")).toBeNull();
  });

  it("shows 'Ready to merge' for mergeable PR", () => {
    mockUsePrStatus.mockReturnValue({
      pr: makePr({ mergeable: true, mergeableState: "clean" }),
      error: null,
      loading: false,
    });
    render(<PrStatusSection wsId="ws-1" />);
    expect(screen.getByText(/Ready to merge/)).toBeDefined();
    expect(screen.getByText(/PR #42/)).toBeDefined();
  });

  it("shows 'Ready to merge' when mergeableState is clean even if mergeable is null", () => {
    mockUsePrStatus.mockReturnValue({
      pr: makePr({ mergeable: null, mergeableState: "clean" }),
      error: null,
      loading: false,
    });
    render(<PrStatusSection wsId="ws-1" />);
    expect(screen.getByText(/Ready to merge/)).toBeDefined();
  });

  it("shows 'Has conflicts' for conflicting PR", () => {
    mockUsePrStatus.mockReturnValue({
      pr: makePr({ mergeable: false, mergeableState: "conflict" }),
      error: null,
      loading: false,
    });
    render(<PrStatusSection wsId="ws-1" />);
    expect(screen.getByText(/Has conflicts/)).toBeDefined();
  });

  it("shows 'Has conflicts' when only mergeable is false (regardless of mergeableState)", () => {
    mockUsePrStatus.mockReturnValue({
      pr: makePr({ mergeable: false, mergeableState: "unknown" }),
      error: null,
      loading: false,
    });
    render(<PrStatusSection wsId="ws-1" />);
    expect(screen.getByText(/Has conflicts/)).toBeDefined();
  });

  it("shows 'Merged' for merged PR", () => {
    mockUsePrStatus.mockReturnValue({
      pr: makePr({ state: "merged" }),
      error: null,
      loading: false,
    });
    render(<PrStatusSection wsId="ws-1" />);
    expect(screen.getByText(/Merged/)).toBeDefined();
  });

  it("shows 'Closed' for closed PR", () => {
    mockUsePrStatus.mockReturnValue({
      pr: makePr({ state: "closed" }),
      error: null,
      loading: false,
    });
    render(<PrStatusSection wsId="ws-1" />);
    expect(screen.getByText(/Closed/)).toBeDefined();
  });

  it("shows 'Draft' for draft PR", () => {
    mockUsePrStatus.mockReturnValue({
      pr: makePr({ state: "draft" }),
      error: null,
      loading: false,
    });
    render(<PrStatusSection wsId="ws-1" />);
    expect(screen.getByText(/Draft/)).toBeDefined();
  });

  it("shows 'Failed' with counts", () => {
    mockUsePrStatus.mockReturnValue({
      pr: makePr({
        checksStatus: "failure",
        checksPassed: 2,
        checksTotal: 5,
      }),
      error: null,
      loading: false,
    });
    render(<PrStatusSection wsId="ws-1" />);
    expect(screen.getByText(/Failed \(2\/5\)/)).toBeDefined();
  });

  it("shows 'Cancelled' for cancelled checks", () => {
    mockUsePrStatus.mockReturnValue({
      pr: makePr({
        checksStatus: "cancelled",
      }),
      error: null,
      loading: false,
    });
    render(<PrStatusSection wsId="ws-1" />);
    expect(screen.getByText(/Cancelled/)).toBeDefined();
  });

  it("shows 'Checks' with counts when checks are pending", () => {
    mockUsePrStatus.mockReturnValue({
      pr: makePr({
        checksStatus: "pending",
        checksPassed: 1,
        checksTotal: 4,
      }),
      error: null,
      loading: false,
    });
    render(<PrStatusSection wsId="ws-1" />);
    expect(screen.getByText(/Checks \(1\/4\)/)).toBeDefined();
  });

  it("shows 'Changes req.' when review asks for changes", () => {
    mockUsePrStatus.mockReturnValue({
      pr: makePr({
        reviewStatus: "changes_requested",
      }),
      error: null,
      loading: false,
    });
    render(<PrStatusSection wsId="ws-1" />);
    expect(screen.getByText(/Changes req\./)).toBeDefined();
  });

  it("shows 'Blocked' for blocked mergeable state", () => {
    mockUsePrStatus.mockReturnValue({
      pr: makePr({
        mergeableState: "blocked",
      }),
      error: null,
      loading: false,
    });
    render(<PrStatusSection wsId="ws-1" />);
    expect(screen.getByText(/Blocked/)).toBeDefined();
  });

  it("shows 'Unstable' for unstable mergeable state", () => {
    mockUsePrStatus.mockReturnValue({
      pr: makePr({
        mergeableState: "unstable",
      }),
      error: null,
      loading: false,
    });
    render(<PrStatusSection wsId="ws-1" />);
    expect(screen.getByText(/Unstable/)).toBeDefined();
  });

  it("shows 'Review needed' when review is required", () => {
    mockUsePrStatus.mockReturnValue({
      pr: makePr({
        reviewStatus: "review_required",
      }),
      error: null,
      loading: false,
    });
    render(<PrStatusSection wsId="ws-1" />);
    expect(screen.getByText(/Review needed/)).toBeDefined();
  });

  it("shows 'Open' as fallback when no specific status applies", () => {
    mockUsePrStatus.mockReturnValue({
      pr: makePr({ state: "open", mergeable: null, mergeableState: "unknown" }),
      error: null,
      loading: false,
    });
    render(<PrStatusSection wsId="ws-1" />);
    expect(screen.getByText(/Open/)).toBeDefined();
  });

  it("prioritizes conflicts over failing checks", () => {
    mockUsePrStatus.mockReturnValue({
      pr: makePr({
        mergeable: false,
        mergeableState: "conflict",
        checksStatus: "failure",
      }),
      error: null,
      loading: false,
    });
    render(<PrStatusSection wsId="ws-1" />);
    expect(screen.getByText(/Has conflicts/)).toBeDefined();
    expect(screen.queryByText(/Failed/)).toBeNull();
  });

  it("prioritizes checks failure over review status", () => {
    mockUsePrStatus.mockReturnValue({
      pr: makePr({
        checksStatus: "failure",
        reviewStatus: "changes_requested",
      }),
      error: null,
      loading: false,
    });
    render(<PrStatusSection wsId="ws-1" />);
    expect(screen.getByText(/Failed/)).toBeDefined();
    expect(screen.queryByText(/Changes req\./)).toBeNull();
  });

  it("prioritizes merged state over all other signals", () => {
    mockUsePrStatus.mockReturnValue({
      pr: makePr({
        state: "merged",
        mergeable: false,
        checksStatus: "failure",
        reviewStatus: "changes_requested",
      }),
      error: null,
      loading: false,
    });
    render(<PrStatusSection wsId="ws-1" />);
    expect(screen.getByText(/Merged/)).toBeDefined();
    expect(screen.queryByText(/Has conflicts/)).toBeNull();
    expect(screen.queryByText(/Failed/)).toBeNull();
  });

  it("renders external link with correct href", () => {
    mockUsePrStatus.mockReturnValue({
      pr: makePr({ url: "https://github.com/acme/widget/pull/99", number: 99 }),
      error: null,
      loading: false,
    });
    render(<PrStatusSection wsId="ws-1" />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("https://github.com/acme/widget/pull/99");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("shows correct PR number in display", () => {
    mockUsePrStatus.mockReturnValue({
      pr: makePr({ number: 123, mergeable: true, mergeableState: "clean" }),
      error: null,
      loading: false,
    });
    render(<PrStatusSection wsId="ws-1" />);
    expect(screen.getByText(/PR #123/)).toBeDefined();
  });
});
