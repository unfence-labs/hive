import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { createTempDir } from "../utils/test-helpers.js";
import { basePromptRoutes } from "./base-prompt.js";
import { DEFAULT_BASE_PROMPT } from "../agents/system-prompt.js";

let tmpDir: string;
let dataDir: string;
let app: FastifyInstance;

beforeEach(async () => {
  tmpDir = await createTempDir();
  dataDir = join(tmpDir, "data");
  app = Fastify();
  await app.register((instance) => basePromptRoutes(instance, { dataDir }));
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

describe("GET /api/prompts/base", () => {
  it("returns default when no file exists", async () => {
    const res = await app.inject({ method: "GET", url: "/api/prompts/base" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.content).toBe(DEFAULT_BASE_PROMPT);
    expect(body.isDefault).toBe(true);
    expect(body.defaultContent).toBe(DEFAULT_BASE_PROMPT);
  });

  it("returns custom content after PUT", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/prompts/base",
      payload: { content: "Custom prompt" },
    });
    const res = await app.inject({ method: "GET", url: "/api/prompts/base" });
    const body = res.json();
    expect(body.content).toBe("Custom prompt");
    expect(body.isDefault).toBe(false);
    expect(body.defaultContent).toBe(DEFAULT_BASE_PROMPT);
  });

  it("returns isDefault true when content matches default", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/prompts/base",
      payload: { content: DEFAULT_BASE_PROMPT },
    });
    const res = await app.inject({ method: "GET", url: "/api/prompts/base" });
    expect(res.json().isDefault).toBe(true);
  });
});

describe("PUT /api/prompts/base", () => {
  it("creates the file and returns updated data", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/prompts/base",
      payload: { content: "New system prompt" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.content).toBe("New system prompt");
    expect(body.isDefault).toBe(false);

    // Verify file on disk
    const onDisk = await readFile(join(dataDir, "prompts", "base.md"), "utf-8");
    expect(onDisk).toBe("New system prompt");
  });

  it("preserves whitespace (no trim on save)", async () => {
    const content = "  leading and trailing spaces  \n\n";
    await app.inject({
      method: "PUT",
      url: "/api/prompts/base",
      payload: { content },
    });
    const onDisk = await readFile(join(dataDir, "prompts", "base.md"), "utf-8");
    expect(onDisk).toBe(content);
  });

  it("rejects empty content (400)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/prompts/base",
      payload: { content: "   " },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects missing content (400)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/prompts/base",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("DELETE /api/prompts/base", () => {
  it("resets to default (204)", async () => {
    // First create a custom prompt
    await app.inject({
      method: "PUT",
      url: "/api/prompts/base",
      payload: { content: "Custom" },
    });

    const res = await app.inject({ method: "DELETE", url: "/api/prompts/base" });
    expect(res.statusCode).toBe(204);

    // GET should return default
    const getRes = await app.inject({ method: "GET", url: "/api/prompts/base" });
    expect(getRes.json().isDefault).toBe(true);
    expect(getRes.json().content).toBe(DEFAULT_BASE_PROMPT);
  });

  it("is idempotent when no file exists", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/prompts/base" });
    expect(res.statusCode).toBe(204);
  });

  it("removes file from disk", async () => {
    // Seed the file
    const dir = join(dataDir, "prompts");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "base.md"), "Custom", "utf-8");

    await app.inject({ method: "DELETE", url: "/api/prompts/base" });

    // File should be gone
    await expect(readFile(join(dir, "base.md"), "utf-8")).rejects.toThrow();
  });
});
