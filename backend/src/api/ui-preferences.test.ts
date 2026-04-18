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

  // Regression: the read path used to sanitize against listProjects(), which
  // meant any transient read failure (empty readdir, corrupt state.json) wiped
  // every folder.projectIds from the response — and the client then flushed
  // that empty state back on the next interaction. Reads must now be raw.
  it("preserves folder refs on read even when no projects are listed", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(dataDir, { recursive: true });
    await writeFile(
      join(dataDir, "ui-preferences.json"),
      JSON.stringify({
        sidebar: {
          folders: [
            { id: "f1", name: "Work", projectIds: ["p-a", "p-b"] },
            { id: "f2", name: "Perso", projectIds: ["p-c"] },
          ],
          folderOpenState: { f1: true, f2: false },
        },
      }),
      "utf-8",
    );

    // No seedProject() — simulates the transient-empty listProjects() case
    const getRes = await app.inject({ method: "GET", url: "/api/ui-preferences" });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().sidebar.folders).toEqual([
      { id: "f1", name: "Work", projectIds: ["p-a", "p-b"] },
      { id: "f2", name: "Perso", projectIds: ["p-c"] },
    ]);
  });

  it("returns raw stored payload without any server-side filtering", async () => {
    await seedProject("p-alive");
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

    // Unknown IDs survive the read — the client filters at display time via
    // mapSidebarFolderProjects, and deletion prunes explicitly.
    const getRes = await app.inject({ method: "GET", url: "/api/ui-preferences" });
    expect(getRes.json().sidebar.folders[0].projectIds).toEqual(["p-alive", "p-dead"]);
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

  // Regression: a transient-empty listProjects() at write time used to drop
  // every ref from the payload. Guard: when no projects are listed but the
  // payload still references some, treat listProjects as unreliable and
  // persist the payload verbatim rather than wiping it.
  it("preserves payload refs when listProjects() is transiently empty", async () => {
    // No seedProject() — simulates listProjects failing/returning empty
    const payload = {
      sidebar: {
        folders: [
          { id: "f1", name: "Work", projectIds: ["p-a", "p-b"] },
          { id: "f2", name: "Perso", projectIds: ["p-c"] },
        ],
        folderOpenState: { f1: true, f2: true },
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

  // The guard only kicks in when we have refs to preserve: a genuinely empty
  // write (e.g. user cleared everything) should still round-trip as empty.
  it("still persists an empty payload when listProjects() is empty", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/ui-preferences",
      payload: { sidebar: { folders: [], folderOpenState: {} } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sidebar: { folders: [], folderOpenState: {} } });
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
