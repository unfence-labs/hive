import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./git.js", () => ({ git: vi.fn() }));

import { git } from "./git.js";
import {
  _resetDefaultBranchRefreshCache,
  refreshDefaultBranchFromOriginStrict,
} from "./git-default-branch.js";

const mockGit = vi.mocked(git);

beforeEach(() => {
  vi.clearAllMocks();
  _resetDefaultBranchRefreshCache();
});

describe("refreshDefaultBranchFromOriginStrict", () => {
  it("accepts a concurrent ref update that already contains the fetched tip", async () => {
    const localRef = "refs/heads/main";
    const oldTip = "a".repeat(40);
    const incomingTip = "b".repeat(40);
    const currentTip = "c".repeat(40);
    let incomingRef = "";
    let localRefReads = 0;

    mockGit.mockImplementation(async (args) => {
      if (args[0] === "fetch") {
        incomingRef = args.at(-1)!.split(":")[1]!;
      } else if (args[0] === "rev-parse" && args[1] === localRef) {
        localRefReads += 1;
        return { stdout: localRefReads === 1 ? oldTip : currentTip, stderr: "" };
      } else if (args[0] === "rev-parse") {
        return { stdout: incomingTip, stderr: "" };
      } else if (args[0] === "update-ref" && args[1] === localRef) {
        throw new Error("reference changed concurrently");
      }
      return { stdout: "", stderr: "" };
    });

    await expect(refreshDefaultBranchFromOriginStrict("/repo.git", "main")).resolves.toBe(
      currentTip,
    );
    expect(localRefReads).toBe(2);
    expect(
      mockGit.mock.calls.filter(
        ([args]) => args[0] === "update-ref" && args[1] === localRef,
      ),
    ).toHaveLength(1);
    expect(mockGit).toHaveBeenCalledWith(
      ["merge-base", "--is-ancestor", incomingTip, currentTip],
      "/repo.git",
    );
    expect(mockGit).toHaveBeenCalledWith(["update-ref", "-d", incomingRef], "/repo.git");
  });
});
