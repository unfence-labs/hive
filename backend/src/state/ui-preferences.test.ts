import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadUiPreferences,
  saveUiPreferences,
  sanitizeUiPreferences,
  type UiPreferences,
} from "./ui-preferences.js";

let dataDir: string;

const EMPTY: UiPreferences = { sidebar: { folders: [], folderOpenState: {} } };

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "hive-ui-prefs-test-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("loadUiPreferences", () => {
  it("returns defaults when file is missing", async () => {
    const prefs = await loadUiPreferences(dataDir);
    expect(prefs).toEqual(EMPTY);
  });

  it("returns defaults when file is invalid JSON", async () => {
    await writeFile(join(dataDir, "ui-preferences.json"), "{not-json", "utf-8");
    const prefs = await loadUiPreferences(dataDir);
    expect(prefs).toEqual(EMPTY);
  });

  it("parses a well-formed file", async () => {
    const full: UiPreferences = {
      sidebar: {
        folders: [
          { id: "f1", name: "Work", projectIds: ["p1", "p2"] },
          { id: "f2", name: "Personal", projectIds: [] },
        ],
        folderOpenState: { f1: true, f2: false },
      },
    };
    await writeFile(join(dataDir, "ui-preferences.json"), JSON.stringify(full), "utf-8");

    const prefs = await loadUiPreferences(dataDir);
    expect(prefs).toEqual(full);
  });

  it("drops malformed folder entries without failing", async () => {
    await writeFile(
      join(dataDir, "ui-preferences.json"),
      JSON.stringify({
        sidebar: {
          folders: [
            { id: "f1", name: "Valid", projectIds: ["p1"] },
            { id: "", name: "Missing id", projectIds: [] },
            { id: "f2", name: "   ", projectIds: [] },
            "not-an-object",
            { id: "f1", name: "Duplicate id", projectIds: [] },
          ],
          folderOpenState: { f1: true, unknown: true, f1b: "not-boolean" },
        },
      }),
      "utf-8",
    );

    const prefs = await loadUiPreferences(dataDir);
    expect(prefs.sidebar.folders).toEqual([{ id: "f1", name: "Valid", projectIds: ["p1"] }]);
    expect(prefs.sidebar.folderOpenState).toEqual({ f1: true });
  });

  it("returns defaults when top-level JSON is not an object", async () => {
    await writeFile(join(dataDir, "ui-preferences.json"), JSON.stringify([1, 2, 3]), "utf-8");
    const prefs = await loadUiPreferences(dataDir);
    expect(prefs).toEqual(EMPTY);
  });
});

describe("saveUiPreferences", () => {
  it("round-trips through loadUiPreferences", async () => {
    const prefs: UiPreferences = {
      sidebar: {
        folders: [{ id: "a", name: "Alpha", projectIds: ["p-1"] }],
        folderOpenState: { a: false },
      },
    };
    await saveUiPreferences(prefs, dataDir);

    const raw = await readFile(join(dataDir, "ui-preferences.json"), "utf-8");
    expect(raw).toContain("\n"); // pretty-printed
    expect(JSON.parse(raw)).toEqual(prefs);

    const loaded = await loadUiPreferences(dataDir);
    expect(loaded).toEqual(prefs);
  });

  it("creates dataDir recursively", async () => {
    const nested = join(dataDir, "deep", "nested");
    await saveUiPreferences(EMPTY, nested);
    expect(await loadUiPreferences(nested)).toEqual(EMPTY);
  });
});

describe("sanitizeUiPreferences", () => {
  it("drops projects that no longer exist", async () => {
    const prefs: UiPreferences = {
      sidebar: {
        folders: [{ id: "f1", name: "Work", projectIds: ["p1", "gone", "p2"] }],
        folderOpenState: { f1: true },
      },
    };
    const sanitized = sanitizeUiPreferences(prefs, ["p1", "p2"]);
    expect(sanitized.sidebar.folders[0].projectIds).toEqual(["p1", "p2"]);
  });

  it("dedupes projects across folders (first wins)", async () => {
    const prefs: UiPreferences = {
      sidebar: {
        folders: [
          { id: "f1", name: "Work", projectIds: ["p1", "p2"] },
          { id: "f2", name: "Personal", projectIds: ["p1", "p3"] },
        ],
        folderOpenState: { f1: true, f2: true },
      },
    };
    const sanitized = sanitizeUiPreferences(prefs, ["p1", "p2", "p3"]);
    expect(sanitized.sidebar.folders[0].projectIds).toEqual(["p1", "p2"]);
    expect(sanitized.sidebar.folders[1].projectIds).toEqual(["p3"]);
  });

  it("drops empty-name folders and trims names", async () => {
    const prefs: UiPreferences = {
      sidebar: {
        folders: [
          { id: "f1", name: "  Work  ", projectIds: [] },
          { id: "f2", name: "   ", projectIds: [] },
        ],
        folderOpenState: { f1: true, f2: true },
      },
    };
    const sanitized = sanitizeUiPreferences(prefs, []);
    expect(sanitized.sidebar.folders).toEqual([
      { id: "f1", name: "Work", projectIds: [] },
    ]);
    expect(sanitized.sidebar.folderOpenState).toEqual({ f1: true });
  });

  it("drops folderOpenState entries for unknown folder ids", async () => {
    const prefs: UiPreferences = {
      sidebar: {
        folders: [{ id: "f1", name: "Work", projectIds: [] }],
        folderOpenState: { f1: true, ghost: false },
      },
    };
    const sanitized = sanitizeUiPreferences(prefs, []);
    expect(sanitized.sidebar.folderOpenState).toEqual({ f1: true });
  });
});
