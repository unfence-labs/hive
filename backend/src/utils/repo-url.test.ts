import { describe, expect, it } from "vitest";
import { normalizeRepositoryUrl, validateRepositoryUrl } from "./repo-url.js";

describe("normalizeRepositoryUrl", () => {
  it("normalizes GitHub scp and ssh clone URLs", () => {
    expect(normalizeRepositoryUrl("git@github.com:acme/repo.git")).toBe(
      "https://github.com/acme/repo.git",
    );
    expect(normalizeRepositoryUrl("ssh://git@github.com/acme/repo.git")).toBe(
      "https://github.com/acme/repo.git",
    );
  });

  it("does not rewrite SSH URLs for other hosts or users", () => {
    expect(normalizeRepositoryUrl("git@gitlab.com:acme/repo.git")).toBe(
      "git@gitlab.com:acme/repo.git",
    );
    expect(normalizeRepositoryUrl("ssh://deploy@github.com/acme/repo.git")).toBe(
      "ssh://deploy@github.com/acme/repo.git",
    );
  });

  it("does not rewrite ambiguous GitHub SSH paths", () => {
    expect(normalizeRepositoryUrl("git@github.com:acme/repo.git?ref=main")).toBe(
      "git@github.com:acme/repo.git?ref=main",
    );
    expect(normalizeRepositoryUrl("ssh://git@github.com/acme/team/repo.git")).toBe(
      "ssh://git@github.com/acme/team/repo.git",
    );
  });
});

describe("validateRepositoryUrl", () => {
  it("accepts https repository urls", () => {
    expect(validateRepositoryUrl("https://github.com/acme/repo.git")).toBe(
      "https://github.com/acme/repo.git",
    );
  });

  it("accepts ssh repository urls", () => {
    expect(validateRepositoryUrl("ssh://git@github.com/acme/repo.git")).toBe(
      "ssh://git@github.com/acme/repo.git",
    );
  });

  it("accepts scp-like git urls", () => {
    expect(validateRepositoryUrl("git@github.com:acme/repo.git")).toBe(
      "git@github.com:acme/repo.git",
    );
  });

  it("rejects file protocol", () => {
    expect(() => validateRepositoryUrl("file:///tmp/repo.git")).toThrow("not allowed");
  });

  it("rejects unsupported protocols", () => {
    expect(() => validateRepositoryUrl("http://github.com/acme/repo.git")).toThrow(
      "Unsupported repository URL protocol",
    );
  });

  it("rejects local paths by default", () => {
    expect(() => validateRepositoryUrl("/tmp/repo.git")).toThrow("Local repository paths are not allowed");
    expect(() => validateRepositoryUrl("./repo.git")).toThrow("Local repository paths are not allowed");
  });

  it("allows local paths when explicitly enabled", () => {
    expect(validateRepositoryUrl("/tmp/repo.git", { allowLocalPath: true })).toBe("/tmp/repo.git");
  });

  it("rejects malformed values", () => {
    expect(() => validateRepositoryUrl("")).toThrow("Invalid repository URL");
    expect(() => validateRepositoryUrl("https://github.com")).toThrow("repository path");
    expect(() => validateRepositoryUrl("not-a-url")).toThrow("Unsupported repository URL format");
  });
});
