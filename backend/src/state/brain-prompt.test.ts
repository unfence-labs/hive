import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "../utils/test-helpers.js";
import { loadBrainPromptData, saveBrainPrompt, resetBrainPrompt } from "./brain-prompt.js";
import { BRAIN_BASE_PROMPT } from "../agents/system-prompt.js";

let tmpDir: string;
let dataDir: string;

beforeEach(async () => {
  tmpDir = await createTempDir();
  dataDir = join(tmpDir, "data");
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

describe("loadBrainPromptData", () => {
  it("returns the hardcoded default when the file is absent", async () => {
    const data = await loadBrainPromptData(dataDir);
    expect(data.content).toBe(BRAIN_BASE_PROMPT);
    expect(data.isDefault).toBe(true);
    expect(data.defaultContent).toBe(BRAIN_BASE_PROMPT);
  });

  it("flags isDefault false for custom content", async () => {
    await saveBrainPrompt("Custom", dataDir);
    const data = await loadBrainPromptData(dataDir);
    expect(data.content).toBe("Custom");
    expect(data.isDefault).toBe(false);
  });
});

describe("saveBrainPrompt", () => {
  it("round-trips through disk", async () => {
    await saveBrainPrompt("Round trip", dataDir);
    const onDisk = await readFile(join(dataDir, "prompts", "brain.md"), "utf-8");
    expect(onDisk).toBe("Round trip");
    const data = await loadBrainPromptData(dataDir);
    expect(data.content).toBe("Round trip");
  });
});

describe("resetBrainPrompt", () => {
  it("removes the file", async () => {
    const dir = join(dataDir, "prompts");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "brain.md"), "Custom", "utf-8");

    await resetBrainPrompt(dataDir);
    await expect(readFile(join(dir, "brain.md"), "utf-8")).rejects.toThrow();
  });

  it("is idempotent when the file is absent", async () => {
    await expect(resetBrainPrompt(dataDir)).resolves.toBeUndefined();
  });
});
