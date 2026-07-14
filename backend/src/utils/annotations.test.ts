import { describe, it, expect } from "vitest";
import { annotationsToMarkdown } from "./annotations.js";
import type { UiAnnotation } from "../types.js";

const element: UiAnnotation = {
  id: 1,
  kind: "element",
  note: "Make this button green",
  pageUrl: "http://localhost:5173/settings",
  selector: '[data-testid="save"]',
  component: "SettingsForm",
  elementText: "Save changes",
  rect: { x: 100, y: 200, w: 80, h: 32 },
  viewport: { w: 1280, h: 720 },
};

const area: UiAnnotation = {
  id: 2,
  kind: "area",
  note: "Too much spacing here",
  pageUrl: "http://localhost:5173/",
  rect: { x: 10.4, y: 20.6, w: 300, h: 150 },
  viewport: { w: 1280, h: 720 },
  selectorsInArea: ["section.cards", "div.header"],
};

describe("annotationsToMarkdown", () => {
  it("serializes element annotations with selector, component and text", () => {
    const md = annotationsToMarkdown([element]);
    expect(md).toContain("## UI annotations (Hive preview)");
    expect(md).toContain("### 1. Make this button green");
    expect(md).toContain('- Selector: `[data-testid="save"]`');
    expect(md).toContain("- React component: `<SettingsForm>`");
    expect(md).toContain('- Text: "Save changes"');
    expect(md).toContain("- Page: http://localhost:5173/settings");
  });

  it("serializes area annotations with rounded rect and contained selectors", () => {
    const md = annotationsToMarkdown([area]);
    expect(md).toContain("### 2. Too much spacing here");
    expect(md).toContain("- Area (page px): x=10, y=21, w=300, h=150");
    expect(md).toContain("- Contains: `section.cards`, `div.header`");
  });

  it("falls back to (no note) for empty notes", () => {
    const md = annotationsToMarkdown([{ ...element, note: "" }]);
    expect(md).toContain("### 1. (no note)");
  });
});
