import { describe, it, expect } from "vitest";
import { filterCompletions } from "@/lib/completion";
import type { CompletionItem } from "@/types";

function makeItem(
  name: string,
  type: CompletionItem["type"],
  source: CompletionItem["source"],
  description?: string,
): CompletionItem {
  return {
    type,
    name,
    label: type === "agent" ? `@${name}` : `/${name}`,
    source,
    ...(description ? { description } : {}),
  };
}

describe("filterCompletions", () => {
  it("matches by substring", () => {
    const items = [
      makeItem("xxx-yyy", "slash_command", "builtin"),
      makeItem("help", "slash_command", "builtin"),
    ];
    const result = filterCompletions(items, "slash_command", "yyy");
    expect(result.map((i) => i.name)).toEqual(["xxx-yyy"]);
  });

  it("matches 'review' inside 'code-review'", () => {
    const items = [
      makeItem("code-review", "slash_command", "builtin"),
      makeItem("help", "slash_command", "builtin"),
    ];
    const result = filterCompletions(items, "slash_command", "review");
    expect(result.map((i) => i.name)).toEqual(["code-review"]);
  });

  it("does not match by loose subsequence", () => {
    const items = [
      makeItem("improve-codebase-architecture", "slash_command", "builtin"),
      makeItem("to-prd", "slash_command", "builtin"),
    ];
    // "prd" is a subsequence of "improve-codebase-architecture" (p…r…d) but not
    // a substring, so only the genuine substring match is returned.
    const result = filterCompletions(items, "slash_command", "prd");
    expect(result.map((i) => i.name)).toEqual(["to-prd"]);
  });

  it("matches the name only, ignoring the description", () => {
    const items = [
      makeItem("deploy", "slash_command", "builtin", "Review and ship a release"),
      makeItem("code-review", "slash_command", "builtin"),
    ];
    // "review" appears in deploy's description but not its name, so only the
    // command whose name matches is returned.
    const result = filterCompletions(items, "slash_command", "review");
    expect(result.map((i) => i.name)).toEqual(["code-review"]);
  });

  it("still matches by prefix", () => {
    const items = [
      makeItem("help", "slash_command", "builtin"),
      makeItem("clear", "slash_command", "builtin"),
    ];
    const result = filterCompletions(items, "slash_command", "he");
    expect(result.map((i) => i.name)).toEqual(["help"]);
  });

  it("returns all items of the type in original order for an empty query", () => {
    const items = [
      makeItem("help", "slash_command", "builtin"),
      makeItem("clear", "slash_command", "builtin"),
      makeItem("reviewer", "agent", "user_agent"),
    ];
    const result = filterCompletions(items, "slash_command", "");
    expect(result.map((i) => i.name)).toEqual(["help", "clear"]);
  });

  it("only returns items of the requested type", () => {
    const items = [
      makeItem("review", "slash_command", "builtin"),
      makeItem("reviewer", "agent", "user_agent"),
    ];
    const slash = filterCompletions(items, "slash_command", "review");
    expect(slash.map((i) => i.name)).toEqual(["review"]);

    const agent = filterCompletions(items, "agent", "review");
    expect(agent.map((i) => i.name)).toEqual(["reviewer"]);
  });

  it("ranks stronger matches first within the same source", () => {
    const items = [
      makeItem("code-review", "slash_command", "builtin"),
      makeItem("review-x", "slash_command", "builtin"),
    ];
    const result = filterCompletions(items, "slash_command", "review");
    // "review-x" is a prefix match (80) and outranks "code-review" (substring, 60).
    expect(result.map((i) => i.name)).toEqual(["review-x", "code-review"]);
  });

  it("respects source priority when scores tie", () => {
    const items = [
      makeItem("review-user", "slash_command", "user_command"),
      makeItem("review-builtin", "slash_command", "builtin"),
    ];
    const result = filterCompletions(items, "slash_command", "review");
    // Both are prefix matches; builtin outranks user_command by source priority.
    expect(result.map((i) => i.name)).toEqual(["review-builtin", "review-user"]);
  });
});
