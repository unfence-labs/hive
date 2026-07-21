import { describe, expect, it } from "vitest";
import { parseReasoningThoughts } from "./reasoning-thoughts.js";

describe("parseReasoningThoughts", () => {
  it("splits a headline and its body into one thought", () => {
    expect(parseReasoningThoughts("**Verifying branch**\n\nChecking the diff is current.", "seg")).toEqual([
      { id: "seg:0", headline: "Verifying branch", body: "Checking the diff is current." },
    ]);
  });

  it("splits concatenated headlines into separate thoughts (kills the **** artifact)", () => {
    expect(parseReasoningThoughts("**Planning diff inspection****Prioritizing backend change**", "seg")).toEqual([
      { id: "seg:0", headline: "Planning diff inspection" },
      { id: "seg:1", headline: "Prioritizing backend change" },
    ]);
  });

  it("keeps a headline-only segment with no body", () => {
    expect(parseReasoningThoughts("**Extracting full README**", "seg")).toEqual([
      { id: "seg:0", headline: "Extracting full README" },
    ]);
  });

  it("treats plain text with no bold as a single body-only thought", () => {
    expect(parseReasoningThoughts("Just thinking out loud here", "seg")).toEqual([
      { id: "seg:0", body: "Just thinking out loud here" },
    ]);
  });

  it("attaches trailing body to the preceding headline", () => {
    expect(parseReasoningThoughts("**First**\n\nbody one\n\n**Second**\n\nbody two", "seg")).toEqual([
      { id: "seg:0", headline: "First", body: "body one" },
      { id: "seg:1", headline: "Second", body: "body two" },
    ]);
  });

  it("strips Codex part separators and collapses whitespace", () => {
    expect(parseReasoningThoughts("**A**<!-- -->**B**", "seg")).toEqual([
      { id: "seg:0", headline: "A" },
      { id: "seg:1", headline: "B" },
    ]);
  });

  it("returns nothing for empty or whitespace-only content", () => {
    expect(parseReasoningThoughts("", "seg")).toEqual([]);
    expect(parseReasoningThoughts("   \n  ", "seg")).toEqual([]);
  });

  it("keeps inline bold literal instead of splitting it into a headline", () => {
    expect(parseReasoningThoughts("Pass `**kwargs` and **all** flags through", "seg")).toEqual([
      { id: "seg:0", body: "Pass `**kwargs` and **all** flags through" },
    ]);
  });

  it("preserves content-bearing HTML comments in reasoning text", () => {
    expect(parseReasoningThoughts("Remove the <!-- analytics --> snippet", "seg")).toEqual([
      { id: "seg:0", body: "Remove the <!-- analytics --> snippet" },
    ]);
  });

  it("drops whitespace-only bold runs without emitting empty headlines", () => {
    expect(parseReasoningThoughts("** **", "seg")).toEqual([]);
    expect(parseReasoningThoughts("**Real** body\n\n** **", "seg")).toEqual([
      { id: "seg:0", headline: "Real", body: "body" },
    ]);
  });
});
