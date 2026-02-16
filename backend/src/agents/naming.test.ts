import { describe, it, expect } from "vitest";
import { sanitizeBranchName, ensureUniqueBranch } from "./naming.js";

describe("sanitizeBranchName", () => {
  it("lowercases input", () => {
    expect(sanitizeBranchName("Fix-Login-Bug")).toBe("fix-login-bug");
  });

  it("strips common prefixes", () => {
    expect(sanitizeBranchName("feat/add-auth")).toBe("add-auth");
    expect(sanitizeBranchName("fix/login-crash")).toBe("login-crash");
    expect(sanitizeBranchName("chore/cleanup")).toBe("cleanup");
    expect(sanitizeBranchName("refactor/api")).toBe("api");
    expect(sanitizeBranchName("docs/readme")).toBe("readme");
    expect(sanitizeBranchName("test/unit")).toBe("unit");
    expect(sanitizeBranchName("workspace/mumbai")).toBe("mumbai");
  });

  it("replaces spaces and underscores with hyphens", () => {
    expect(sanitizeBranchName("add user auth")).toBe("add-user-auth");
    expect(sanitizeBranchName("add_user_auth")).toBe("add-user-auth");
  });

  it("removes invalid characters", () => {
    expect(sanitizeBranchName("add-auth!@#$%")).toBe("add-auth");
  });

  it("collapses consecutive hyphens", () => {
    expect(sanitizeBranchName("add---auth")).toBe("add-auth");
  });

  it("trims leading and trailing hyphens", () => {
    expect(sanitizeBranchName("-add-auth-")).toBe("add-auth");
  });

  it("truncates to 50 characters", () => {
    const long = "a".repeat(60);
    expect(sanitizeBranchName(long).length).toBe(50);
  });

  it("returns empty for too-short results", () => {
    expect(sanitizeBranchName("ab")).toBe("");
    expect(sanitizeBranchName("--")).toBe("");
  });

  it("handles empty string", () => {
    expect(sanitizeBranchName("")).toBe("");
  });
});

describe("ensureUniqueBranch", () => {
  it("returns name as-is if unique", () => {
    expect(ensureUniqueBranch("add-auth", ["main", "dev"])).toBe("add-auth");
  });

  it("appends -2 if name exists", () => {
    expect(ensureUniqueBranch("add-auth", ["add-auth", "main"])).toBe("add-auth-2");
  });

  it("increments suffix until unique", () => {
    expect(ensureUniqueBranch("fix", ["fix", "fix-2", "fix-3"])).toBe("fix-4");
  });

  it("handles all suffixes taken up to -9", () => {
    const existing = ["name", ...Array.from({ length: 8 }, (_, i) => `name-${i + 2}`)];
    const result = ensureUniqueBranch("name", existing);
    // Should get a timestamp-based suffix
    expect(result).toMatch(/^name-[a-z0-9]{4}$/);
  });
});
