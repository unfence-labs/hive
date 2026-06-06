import { describe, expect, it } from "vitest";
import { workspaceDiffTotals } from "@/lib/workspace-activity";
import type { WorkspaceLiveData } from "@/hooks/useWorkspaceLiveData";
import type { DiffFileStat } from "@/types";

function stat(additions: number, deletions: number, file = "a.ts"): DiffFileStat {
  return { file, additions, deletions, status: "modified" };
}

function live(diffStats?: WorkspaceLiveData["diffStats"]): WorkspaceLiveData {
  return { diffStats } as WorkspaceLiveData;
}

describe("workspaceDiffTotals", () => {
  it("returns null when there is no live data", () => {
    expect(workspaceDiffTotals(undefined)).toBeNull();
  });

  it("returns null when diff stats are absent", () => {
    expect(workspaceDiffTotals(live(undefined))).toBeNull();
  });

  it("returns null when there are no changed files", () => {
    expect(workspaceDiffTotals(live({ committed: [], uncommitted: [] }))).toBeNull();
  });

  it("returns null when all changes sum to zero", () => {
    expect(
      workspaceDiffTotals(live({ committed: [stat(0, 0)], uncommitted: [] })),
    ).toBeNull();
  });

  it("sums committed and uncommitted additions/deletions (combined scope)", () => {
    const totals = workspaceDiffTotals(
      live({
        committed: [stat(10, 2, "a.ts"), stat(5, 0, "b.ts")],
        uncommitted: [stat(3, 4, "c.ts")],
      }),
    );
    expect(totals).toEqual({ additions: 18, deletions: 6 });
  });
});
