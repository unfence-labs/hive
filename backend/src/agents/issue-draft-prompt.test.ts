import { describe, it, expect } from "vitest";
import {
  DEFAULT_ISSUE_DRAFT_PROMPT,
  interpolateIssueDraftPrompt,
} from "./issue-draft-prompt.js";

const values = {
  number: 45,
  title: "Sidebar flickers",
  url: "https://github.com/acme/demo/issues/45",
  body: "Repro steps",
};

describe("interpolateIssueDraftPrompt", () => {
  it("replaces all four placeholders in the default template", () => {
    const result = interpolateIssueDraftPrompt(DEFAULT_ISSUE_DRAFT_PROMPT, values);
    expect(result).toBe(
      "Work on issue #45: Sidebar flickers\nhttps://github.com/acme/demo/issues/45\n\nRepro steps",
    );
  });

  it("trims trailing blank lines when the body is empty", () => {
    const result = interpolateIssueDraftPrompt(DEFAULT_ISSUE_DRAFT_PROMPT, {
      ...values,
      body: "",
    });
    expect(result).toBe(
      "Work on issue #45: Sidebar flickers\nhttps://github.com/acme/demo/issues/45",
    );
  });

  it("replaces repeated occurrences of a placeholder", () => {
    const result = interpolateIssueDraftPrompt("#{NUMBER} and again #{NUMBER}: {TITLE}/{TITLE}", values);
    expect(result).toBe("#45 and again #45: Sidebar flickers/Sidebar flickers");
  });
});
