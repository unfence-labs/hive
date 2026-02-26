import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "../utils/test-helpers.js";
import { loadPromptTemplates, savePromptTemplates } from "./prompt-templates.js";
import type { PromptTemplate } from "../types.js";

let dataDir: string;

function makeTemplate(overrides: Partial<PromptTemplate> = {}): PromptTemplate {
  return {
    id: "tpl-test1",
    name: "Test Template",
    type: "system",
    content: "You are a helpful assistant.",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(async () => {
  const tmp = await createTempDir();
  dataDir = join(tmp, "data");
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
});

describe("prompt templates persistence", () => {
  it("returns empty array when no file exists", async () => {
    const result = await loadPromptTemplates(dataDir);
    expect(result).toEqual([]);
  });

  it("saves and loads templates", async () => {
    const templates = [
      makeTemplate(),
      makeTemplate({ id: "tpl-test2", name: "User Prompt", type: "user" }),
    ];
    await savePromptTemplates(templates, dataDir);
    const loaded = await loadPromptTemplates(dataDir);
    expect(loaded).toHaveLength(2);
    expect(loaded[0].type).toBe("system");
    expect(loaded[1].type).toBe("user");
  });

  it("overwrites on save", async () => {
    await savePromptTemplates([makeTemplate()], dataDir);
    await savePromptTemplates([makeTemplate({ name: "Updated" })], dataDir);
    const loaded = await loadPromptTemplates(dataDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("Updated");
  });
});
