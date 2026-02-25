// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("index.css streamdown interaction fixes", () => {
  it("keeps streamdown code-block interaction overrides", async () => {
    const css = await readFile(join(process.cwd(), "src", "index.css"), "utf-8");

    expect(css).toContain('[data-streamdown="code-block"]');
    expect(css).toContain("content-visibility: visible !important;");
    expect(css).toContain('[data-streamdown="code-block-copy-button"]');
    expect(css).toContain('[data-streamdown="code-block-download-button"]');
    expect(css).toContain("pointer-events: auto !important;");
    expect(css).toContain("z-index: 30;");
  });
});
