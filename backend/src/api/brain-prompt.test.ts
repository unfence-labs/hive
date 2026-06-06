import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { createTempDir } from "../utils/test-helpers.js";
import { brainPromptRoutes } from "./brain-prompt.js";
import { BRAIN_BASE_PROMPT } from "../agents/system-prompt.js";

let tmpDir: string;
let dataDir: string;
let app: FastifyInstance;

beforeEach(async () => {
  tmpDir = await createTempDir();
  dataDir = join(tmpDir, "data");
  app = Fastify();
  await app.register((instance) => brainPromptRoutes(instance, { dataDir }));
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

describe("GET /api/prompts/brain", () => {
  it("returns default when no file exists", async () => {
    const res = await app.inject({ method: "GET", url: "/api/prompts/brain" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.content).toBe(BRAIN_BASE_PROMPT);
    expect(body.isDefault).toBe(true);
    expect(body.defaultContent).toBe(BRAIN_BASE_PROMPT);
  });

  it("returns custom content after PUT", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/prompts/brain",
      payload: { content: "Custom brain prompt" },
    });
    const res = await app.inject({ method: "GET", url: "/api/prompts/brain" });
    const body = res.json();
    expect(body.content).toBe("Custom brain prompt");
    expect(body.isDefault).toBe(false);
    expect(body.defaultContent).toBe(BRAIN_BASE_PROMPT);
  });

  it("returns isDefault true when content matches default", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/prompts/brain",
      payload: { content: BRAIN_BASE_PROMPT },
    });
    const res = await app.inject({ method: "GET", url: "/api/prompts/brain" });
    expect(res.json().isDefault).toBe(true);
  });
});

describe("PUT /api/prompts/brain", () => {
  it("creates the file and returns updated data", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/prompts/brain",
      payload: { content: "New brain prompt" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.content).toBe("New brain prompt");
    expect(body.isDefault).toBe(false);

    const onDisk = await readFile(join(dataDir, "prompts", "brain.md"), "utf-8");
    expect(onDisk).toBe("New brain prompt");
  });

  it("preserves whitespace (no trim on save)", async () => {
    const content = "  leading and trailing spaces  \n\n";
    await app.inject({
      method: "PUT",
      url: "/api/prompts/brain",
      payload: { content },
    });
    const onDisk = await readFile(join(dataDir, "prompts", "brain.md"), "utf-8");
    expect(onDisk).toBe(content);
  });

  it("rejects empty content (400)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/prompts/brain",
      payload: { content: "   " },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects missing content (400)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/prompts/brain",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("DELETE /api/prompts/brain", () => {
  it("resets to default (204)", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/prompts/brain",
      payload: { content: "Custom" },
    });

    const res = await app.inject({ method: "DELETE", url: "/api/prompts/brain" });
    expect(res.statusCode).toBe(204);

    const getRes = await app.inject({ method: "GET", url: "/api/prompts/brain" });
    expect(getRes.json().isDefault).toBe(true);
    expect(getRes.json().content).toBe(BRAIN_BASE_PROMPT);
  });

  it("is idempotent when no file exists", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/prompts/brain" });
    expect(res.statusCode).toBe(204);
  });

  it("removes file from disk", async () => {
    const dir = join(dataDir, "prompts");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "brain.md"), "Custom", "utf-8");

    await app.inject({ method: "DELETE", url: "/api/prompts/brain" });

    await expect(readFile(join(dir, "brain.md"), "utf-8")).rejects.toThrow();
  });
});
