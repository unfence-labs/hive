import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { createTempDir } from "../utils/test-helpers.js";
import { saveProject } from "../state/state.js";
import { uiPreferencesRoutes } from "./ui-preferences.js";

let tmpDir: string;
let dataDir: string;
let app: FastifyInstance;

async function seedProject(id: string): Promise<void> {
  await saveProject(
    {
      id,
      name: id,
      url: `https://example.test/${id}.git`,
      createdAt: new Date().toISOString(),
      workspaces: [],
    },
    dataDir,
  );
}

beforeEach(async () => {
  tmpDir = await createTempDir("hive-ui-prefs-api-test-");
  dataDir = join(tmpDir, "data");
  app = Fastify();
  await app.register((instance) => uiPreferencesRoutes(instance, { dataDir }));
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(tmpDir, { recursive: true, force: true });
});

describe("GET /api/ui-preferences", () => {
  it("returns empty defaults when nothing is stored", async () => {
    const res = await app.inject({ method: "GET", url: "/api/ui-preferences" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sidebar: { folders: [], folderOpenState: {} } });
  });

  it("prunes folders referencing deleted projects at read time", async () => {
    await seedProject("p-alive");
    const res = await app.inject({
      method: "PUT",
      url: "/api/ui-preferences",
      payload: {
        sidebar: {
          folders: [{ id: "f1", name: "Work", projectIds: ["p-alive"] }],
          folderOpenState: { f1: true },
        },
      },
    });
    expect(res.statusCode).toBe(200);

    // Now write a raw file that references a dead project — simulate a project deletion
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(dataDir, "ui-preferences.json"),
      JSON.stringify({
        sidebar: {
          folders: [
            { id: "f1", name: "Work", projectIds: ["p-alive", "p-dead"] },
          ],
          folderOpenState: { f1: true },
        },
      }),
      "utf-8",
    );

    const getRes = await app.inject({ method: "GET", url: "/api/ui-preferences" });
    expect(getRes.json().sidebar.folders[0].projectIds).toEqual(["p-alive"]);
  });
});

describe("PUT /api/ui-preferences", () => {
  it("stores and returns the payload", async () => {
    await seedProject("p1");
    await seedProject("p2");

    const payload = {
      sidebar: {
        folders: [{ id: "f1", name: "Work", projectIds: ["p1", "p2"] }],
        folderOpenState: { f1: true },
      },
    };
    const res = await app.inject({
      method: "PUT",
      url: "/api/ui-preferences",
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(payload);

    const onDisk = JSON.parse(
      await readFile(join(dataDir, "ui-preferences.json"), "utf-8"),
    );
    expect(onDisk).toEqual(payload);
  });

  it("strips unknown project ids before saving", async () => {
    await seedProject("p1");
    const res = await app.inject({
      method: "PUT",
      url: "/api/ui-preferences",
      payload: {
        sidebar: {
          folders: [{ id: "f1", name: "Work", projectIds: ["p1", "bogus"] }],
          folderOpenState: { f1: true },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sidebar.folders[0].projectIds).toEqual(["p1"]);
  });

  it("rejects payload missing sidebar (400)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/ui-preferences",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects folder entries with wrong shape (400)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/ui-preferences",
      payload: {
        sidebar: {
          folders: [{ id: "f1", name: "Work", projectIds: [42] }],
          folderOpenState: {},
        },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects non-boolean folderOpenState values (400)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/ui-preferences",
      payload: {
        sidebar: {
          folders: [],
          folderOpenState: { f1: "yes" },
        },
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
