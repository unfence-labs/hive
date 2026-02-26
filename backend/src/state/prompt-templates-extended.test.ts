/**
 * Extended prompt template state persistence tests.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "../utils/test-helpers.js";
import {
  loadPromptTemplates,
  savePromptTemplates,
  withTemplatesLock,
} from "./prompt-templates.js";
import type { PromptTemplate } from "../types.js";

let dataDir: string;
let tmpDir: string;

function makeTemplate(overrides: Partial<PromptTemplate> = {}): PromptTemplate {
  return {
    id: "tpl-1",
    name: "Test Template",
    type: "system",
    content: "You are a helpful assistant.",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(async () => {
  tmpDir = await createTempDir();
  dataDir = join(tmpDir, "data");
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

describe("withTemplatesLock", () => {
  it("serializes concurrent operations", async () => {
    const order: number[] = [];

    await Promise.all([
      withTemplatesLock(async () => {
        await new Promise((r) => setTimeout(r, 50));
        order.push(1);
      }),
      withTemplatesLock(async () => {
        order.push(2);
      }),
    ]);

    expect(order).toEqual([1, 2]);
  });

  it("releases lock even when inner function throws", async () => {
    await expect(
      withTemplatesLock(async () => {
        throw new Error("template error");
      }),
    ).rejects.toThrow("template error");

    const result = await withTemplatesLock(async () => "ok");
    expect(result).toBe("ok");
  });

  it("returns the inner function result", async () => {
    const result = await withTemplatesLock(async () => 42);
    expect(result).toBe(42);
  });
});

describe("atomicWrite behavior", () => {
  it("creates directory if it does not exist", async () => {
    await savePromptTemplates([makeTemplate()], dataDir);

    const files = await readdir(dataDir);
    expect(files).toContain("prompt-templates.json");
  });

  it("writes valid JSON", async () => {
    const tpl = makeTemplate({ content: 'Special "chars" & <html>' });
    await savePromptTemplates([tpl], dataDir);

    const raw = await readFile(join(dataDir, "prompt-templates.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed[0].content).toBe('Special "chars" & <html>');
  });

  it("no temp files left after write", async () => {
    await savePromptTemplates([makeTemplate()], dataDir);

    const files = await readdir(dataDir);
    const tmpFiles = files.filter((f) => f.startsWith("tmp."));
    expect(tmpFiles).toHaveLength(0);
  });
});

describe("loadPromptTemplates edge cases", () => {
  it("returns empty array for non-existent directory", async () => {
    const result = await loadPromptTemplates("/tmp/nonexistent-" + Date.now());
    expect(result).toEqual([]);
  });

  it("preserves all template fields through save/load cycle", async () => {
    const tpl = makeTemplate({
      id: "tpl-full",
      name: "Full Template",
      type: "user",
      content: "Multi\nline\ncontent",
      createdAt: "2026-01-15T10:30:00Z",
      updatedAt: "2026-01-20T14:00:00Z",
    });
    await savePromptTemplates([tpl], dataDir);

    const loaded = await loadPromptTemplates(dataDir);
    expect(loaded[0]).toEqual(tpl);
  });

  it("handles many templates", async () => {
    const templates = Array.from({ length: 100 }, (_, i) =>
      makeTemplate({ id: `tpl-${i}`, name: `Template ${i}` }),
    );
    await savePromptTemplates(templates, dataDir);

    const loaded = await loadPromptTemplates(dataDir);
    expect(loaded).toHaveLength(100);
    expect(loaded[99].name).toBe("Template 99");
  });
});
