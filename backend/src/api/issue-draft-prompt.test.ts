import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { createTempDir } from "../utils/test-helpers.js";
import { issueDraftPromptRoutes } from "./issue-draft-prompt.js";
import { DEFAULT_ISSUE_DRAFT_PROMPT } from "../agents/issue-draft-prompt.js";

let tmpDir: string;
let dataDir: string;
let app: FastifyInstance;

beforeEach(async () => {
  tmpDir = await createTempDir();
  dataDir = join(tmpDir, "data");
  app = Fastify();
  await app.register((instance) => issueDraftPromptRoutes(instance, { dataDir }));
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

describe("GET /api/prompts/issue-draft", () => {
  it("returns default when no file exists", async () => {
    const res = await app.inject({ method: "GET", url: "/api/prompts/issue-draft" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.content).toBe(DEFAULT_ISSUE_DRAFT_PROMPT);
    expect(body.isDefault).toBe(true);
    expect(body.defaultContent).toBe(DEFAULT_ISSUE_DRAFT_PROMPT);
  });

  it("returns custom content after PUT", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/prompts/issue-draft",
      payload: { content: "Custom draft" },
    });
    const res = await app.inject({ method: "GET", url: "/api/prompts/issue-draft" });
    const body = res.json();
    expect(body.content).toBe("Custom draft");
    expect(body.isDefault).toBe(false);
    expect(body.defaultContent).toBe(DEFAULT_ISSUE_DRAFT_PROMPT);
  });

  it("returns isDefault true when content matches default", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/prompts/issue-draft",
      payload: { content: DEFAULT_ISSUE_DRAFT_PROMPT },
    });
    const res = await app.inject({ method: "GET", url: "/api/prompts/issue-draft" });
    expect(res.json().isDefault).toBe(true);
  });
});

describe("PUT /api/prompts/issue-draft", () => {
  it("creates the file and returns updated data", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/prompts/issue-draft",
      payload: { content: "New draft template" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.content).toBe("New draft template");
    expect(body.isDefault).toBe(false);

    // Verify file on disk
    const onDisk = await readFile(join(dataDir, "prompts", "issue-draft.md"), "utf-8");
    expect(onDisk).toBe("New draft template");
  });

  it("preserves whitespace (no trim on save)", async () => {
    const content = "  leading and trailing spaces  \n\n";
    await app.inject({
      method: "PUT",
      url: "/api/prompts/issue-draft",
      payload: { content },
    });
    const onDisk = await readFile(join(dataDir, "prompts", "issue-draft.md"), "utf-8");
    expect(onDisk).toBe(content);
  });

  it("rejects empty content (400)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/prompts/issue-draft",
      payload: { content: "   " },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects missing content (400)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/prompts/issue-draft",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("DELETE /api/prompts/issue-draft", () => {
  it("resets to default (204)", async () => {
    // First create a custom prompt
    await app.inject({
      method: "PUT",
      url: "/api/prompts/issue-draft",
      payload: { content: "Custom" },
    });

    const res = await app.inject({ method: "DELETE", url: "/api/prompts/issue-draft" });
    expect(res.statusCode).toBe(204);

    // GET should return default
    const getRes = await app.inject({ method: "GET", url: "/api/prompts/issue-draft" });
    expect(getRes.json().isDefault).toBe(true);
    expect(getRes.json().content).toBe(DEFAULT_ISSUE_DRAFT_PROMPT);
  });

  it("is idempotent when no file exists", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/prompts/issue-draft" });
    expect(res.statusCode).toBe(204);
  });

  it("removes file from disk", async () => {
    // Seed the file
    const dir = join(dataDir, "prompts");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "issue-draft.md"), "Custom", "utf-8");

    await app.inject({ method: "DELETE", url: "/api/prompts/issue-draft" });

    // File should be gone
    await expect(readFile(join(dir, "issue-draft.md"), "utf-8")).rejects.toThrow();
  });
});
