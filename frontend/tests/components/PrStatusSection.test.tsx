import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PrStatusSection } from "@/components/PrStatusSection";
import type { BranchInfo, PullRequestInfo } from "@/types";

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

function makeBranch(overrides: Partial<BranchInfo> = {}): BranchInfo {
  return {
    name: "workspace/tokyo",
    lastSyncedAt: "2026-02-15T00:00:00.000Z",
    ...overrides,
  };
}

describe("PrStatusSection", () => {
  it("shows 'No pull request' when branchInfo is undefined", () => {
    render(<PrStatusSection />);
    expect(screen.getByText("No pull request")).toBeDefined();
  });

  it("shows 'No pull request' when branchInfo has no PR", () => {
    render(<PrStatusSection branchInfo={makeBranch({ pr: null })} />);
    expect(screen.getByText("No pull request")).toBeDefined();
  });

  it("shows 'No pull request' when branchInfo has no pr field at all", () => {
    render(<PrStatusSection branchInfo={makeBranch()} />);
    expect(screen.getByText("No pull request")).toBeDefined();
  });

  it("shows error message when prSyncError is set", () => {
    render(
      <PrStatusSection
        branchInfo={makeBranch({ prSyncError: "gh CLI not installed" })}
      />,
    );
    expect(screen.getByText("gh CLI not installed")).toBeDefined();
  });

  it("prioritizes error over missing PR (shows error, not 'No pull request')", () => {
    render(
      <PrStatusSection
        branchInfo={makeBranch({ prSyncError: "gh not authenticated — run `gh auth login`" })}
      />,
    );
    expect(screen.getByText(/gh not authenticated/)).toBeDefined();
    expect(screen.queryByText("No pull request")).toBeNull();
  });

  it("shows 'Ready to merge' for mergeable PR", () => {
    render(
      <PrStatusSection
        branchInfo={makeBranch({
          pr: makePr({ mergeable: true, mergeableState: "clean" }),
        })}
      />,
    );
    expect(screen.getByText(/Ready to merge/)).toBeDefined();
    expect(screen.getByText(/PR #42/)).toBeDefined();
  });

  it("shows 'Ready to merge' when mergeableState is clean even if mergeable is null", () => {
    render(
      <PrStatusSection
        branchInfo={makeBranch({
          pr: makePr({ mergeable: null, mergeableState: "clean" }),
        })}
      />,
    );
    expect(screen.getByText(/Ready to merge/)).toBeDefined();
  });

  it("shows 'Has conflicts' for conflicting PR", () => {
    render(
      <PrStatusSection
        branchInfo={makeBranch({
          pr: makePr({ mergeable: false, mergeableState: "conflict" }),
        })}
      />,
    );
    expect(screen.getByText(/Has conflicts/)).toBeDefined();
  });

  it("shows 'Has conflicts' when only mergeable is false (regardless of mergeableState)", () => {
    render(
      <PrStatusSection
        branchInfo={makeBranch({
          pr: makePr({ mergeable: false, mergeableState: "unknown" }),
        })}
      />,
    );
    expect(screen.getByText(/Has conflicts/)).toBeDefined();
  });

  it("shows 'Merged' for merged PR", () => {
    render(
      <PrStatusSection
        branchInfo={makeBranch({
          pr: makePr({ state: "merged" }),
        })}
      />,
    );
    expect(screen.getByText(/Merged/)).toBeDefined();
  });

  it("shows 'Checking…' for PR with unknown state (not mergeable, not conflicting, not merged)", () => {
    render(
      <PrStatusSection
        branchInfo={makeBranch({
          pr: makePr({
            state: "open",
            mergeable: null,
            mergeableState: "unknown",
          }),
        })}
      />,
    );
    expect(screen.getByText(/Checking/)).toBeDefined();
  });

  it("renders external link with correct href", () => {
    render(
      <PrStatusSection
        branchInfo={makeBranch({
          pr: makePr({ url: "https://github.com/acme/widget/pull/99", number: 99 }),
        })}
      />,
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("https://github.com/acme/widget/pull/99");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("shows correct PR number in display", () => {
    render(
      <PrStatusSection
        branchInfo={makeBranch({
          pr: makePr({ number: 123, mergeable: true, mergeableState: "clean" }),
        })}
      />,
    );
    expect(screen.getByText(/PR #123/)).toBeDefined();
  });

  it("shows draft PR as 'Checking…' (draft is just an open state variant)", () => {
    render(
      <PrStatusSection
        branchInfo={makeBranch({
          pr: makePr({
            state: "draft",
            mergeable: null,
            mergeableState: "unknown",
          }),
        })}
      />,
    );
    // Draft with unknown merge state should show "Checking…"
    expect(screen.getByText(/Checking/)).toBeDefined();
  });

  it("shows closed PR as 'Checking…' (no special label for closed)", () => {
    render(
      <PrStatusSection
        branchInfo={makeBranch({
          pr: makePr({
            state: "closed",
            mergeable: null,
            mergeableState: "unknown",
          }),
        })}
      />,
    );
    expect(screen.getByText(/Checking/)).toBeDefined();
  });
});
