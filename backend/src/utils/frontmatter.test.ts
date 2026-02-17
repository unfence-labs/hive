import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "./frontmatter.js";

describe("parseFrontmatter", () => {
  // ── No frontmatter ──────────────────────────────────────────────────

  it("returns empty object when content has no frontmatter block", () => {
    expect(parseFrontmatter("just some text\nno frontmatter here")).toEqual({});
  });

  it("returns empty object for empty string", () => {
    expect(parseFrontmatter("")).toEqual({});
  });

  it("returns empty object when --- is not at the start", () => {
    expect(parseFrontmatter("text\n---\nkey: value\n---")).toEqual({});
  });

  // ── String values ───────────────────────────────────────────────────

  it("parses simple key-value strings", () => {
    const content = "---\ntitle: My Title\nauthor: John\n---\nbody";
    expect(parseFrontmatter(content)).toEqual({
      title: "My Title",
      author: "John",
    });
  });

  it("handles colons in value part (only splits on first colon)", () => {
    const content = "---\nurl: https://example.com:8080/path\n---";
    expect(parseFrontmatter(content)).toEqual({
      url: "https://example.com:8080/path",
    });
  });

  // ── Boolean values ──────────────────────────────────────────────────

  it("parses true boolean", () => {
    const content = "---\nenabled: true\n---";
    expect(parseFrontmatter(content)).toEqual({ enabled: true });
  });

  it("parses false boolean", () => {
    const content = "---\nenabled: false\n---";
    expect(parseFrontmatter(content)).toEqual({ enabled: false });
  });

  it("does not parse 'True' or 'FALSE' as booleans", () => {
    const content = "---\na: True\nb: FALSE\n---";
    expect(parseFrontmatter(content)).toEqual({ a: "True", b: "FALSE" });
  });

  // ── Bracket arrays ─────────────────────────────────────────────────

  it("parses bracket array [a, b, c]", () => {
    const content = "---\ntools: [Task, Read, Glob]\n---";
    expect(parseFrontmatter(content)).toEqual({
      tools: ["Task", "Read", "Glob"],
    });
  });

  it("handles bracket array with extra spaces", () => {
    const content = "---\ntools: [ Task ,  Read , Glob ]\n---";
    expect(parseFrontmatter(content)).toEqual({
      tools: ["Task", "Read", "Glob"],
    });
  });

  it("filters empty elements from bracket arrays", () => {
    const content = "---\ntools: [Task, , , Glob]\n---";
    expect(parseFrontmatter(content)).toEqual({
      tools: ["Task", "Glob"],
    });
  });

  it("returns empty array for empty brackets", () => {
    const content = "---\ntools: []\n---";
    expect(parseFrontmatter(content)).toEqual({ tools: [] });
  });

  // ── Quoted values ──────────────────────────────────────────────────

  it("strips double quotes from value", () => {
    const content = '---\ntitle: "My Title"\n---';
    expect(parseFrontmatter(content)).toEqual({ title: "My Title" });
  });

  it("strips single quotes from value", () => {
    const content = "---\ntitle: 'My Title'\n---";
    expect(parseFrontmatter(content)).toEqual({ title: "My Title" });
  });

  it("does not strip mismatched quotes", () => {
    const content = "---\ntitle: \"My Title'\n---";
    expect(parseFrontmatter(content)).toEqual({ title: "\"My Title'" });
  });

  // ── YAML folded scalar indicator ───────────────────────────────────

  it("converts > (folded scalar) to empty string", () => {
    const content = "---\ndescription: >\n---";
    expect(parseFrontmatter(content)).toEqual({ description: "" });
  });

  // ── allowed-tools comma split ──────────────────────────────────────

  it("splits allowed-tools comma-separated value into array", () => {
    const content = "---\nallowed-tools: Read, Grep, Glob\n---";
    expect(parseFrontmatter(content)).toEqual({
      "allowed-tools": ["Read", "Grep", "Glob"],
    });
  });

  it("does not comma-split non-allowed-tools keys", () => {
    const content = "---\ndescription: one, two, three\n---";
    expect(parseFrontmatter(content)).toEqual({
      description: "one, two, three",
    });
  });

  // ── Skipped lines ──────────────────────────────────────────────────

  it("skips comment lines starting with #", () => {
    const content = "---\n# comment\ntitle: value\n---";
    expect(parseFrontmatter(content)).toEqual({ title: "value" });
  });

  it("skips blank lines", () => {
    const content = "---\n\ntitle: value\n\n---";
    expect(parseFrontmatter(content)).toEqual({ title: "value" });
  });

  it("skips lines without colons", () => {
    const content = "---\nno-colon-here\ntitle: value\n---";
    expect(parseFrontmatter(content)).toEqual({ title: "value" });
  });

  it("skips lines with empty key", () => {
    const content = "---\n: orphan-value\ntitle: value\n---";
    expect(parseFrontmatter(content)).toEqual({ title: "value" });
  });

  it("skips lines with empty value", () => {
    const content = "---\nempty-key:\ntitle: value\n---";
    expect(parseFrontmatter(content)).toEqual({ title: "value" });
  });

  // ── Duplicate keys ─────────────────────────────────────────────────

  it("last value wins for duplicate keys", () => {
    const content = "---\ntitle: first\ntitle: second\n---";
    expect(parseFrontmatter(content)).toEqual({ title: "second" });
  });

  // ── CRLF handling ──────────────────────────────────────────────────

  it("handles CRLF line endings in the fence markers", () => {
    const content = "---\r\ntitle: value\r\n---\r\nbody";
    expect(parseFrontmatter(content)).toEqual({ title: "value" });
  });

  // ── Mixed complex frontmatter ──────────────────────────────────────

  it("parses a realistic SKILL.md frontmatter block", () => {
    const content = `---
name: my-skill
description: "A useful skill"
enabled: true
allowed-tools: Task, Read, Glob, Grep
tags: [productivity, automation]
version: 1.0
---
# My Skill

Skill body here`;

    expect(parseFrontmatter(content)).toEqual({
      name: "my-skill",
      description: "A useful skill",
      enabled: true,
      "allowed-tools": ["Task", "Read", "Glob", "Grep"],
      tags: ["productivity", "automation"],
      version: "1.0",
    });
  });
});
