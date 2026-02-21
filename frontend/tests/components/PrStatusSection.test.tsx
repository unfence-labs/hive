import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
    ...overrides,
  };
}

describe("PrStatusSection", () => {
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

  it("shows 'Checking…' for PR with unknown state (not mergeable, not conflicting, not merged)", () => {
    mockUsePrStatus.mockReturnValue({
      pr: makePr({ state: "open", mergeable: null, mergeableState: "unknown" }),
      error: null,
      loading: false,
    });
    render(<PrStatusSection wsId="ws-1" />);
    expect(screen.getByText(/Checking/)).toBeDefined();
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

  it("shows draft PR as 'Checking…' (draft is just an open state variant)", () => {
    mockUsePrStatus.mockReturnValue({
      pr: makePr({ state: "draft", mergeable: null, mergeableState: "unknown" }),
      error: null,
      loading: false,
    });
    render(<PrStatusSection wsId="ws-1" />);
    expect(screen.getByText(/Checking/)).toBeDefined();
  });

  it("shows closed PR as 'Checking…' (no special label for closed)", () => {
    mockUsePrStatus.mockReturnValue({
      pr: makePr({ state: "closed", mergeable: null, mergeableState: "unknown" }),
      error: null,
      loading: false,
    });
    render(<PrStatusSection wsId="ws-1" />);
    expect(screen.getByText(/Checking/)).toBeDefined();
  });
});
