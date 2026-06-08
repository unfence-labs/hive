import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { createBrain, connectBrain, deleteBrain } from "../brain/brain-repo.js";
import {
  getBrainFileEntry,
  listBrainFiles,
  readBrainFile,
  writeBrainFile,
} from "../brain/brain-files.js";
import { getBrainDiff, getBrainStatus, saveBrain } from "../brain/brain-git.js";
import { loadBrainState } from "../state/brain.js";
import { getDataDir } from "../state/state.js";
import { BadRequestError, errorMessage, errorStatus } from "../utils/errors.js";
import { headerFilename, rawFileContentType } from "../utils/raw-file.js";

type BrainRequest =
  | { mode: "create"; name?: string }
  | { mode: "connect"; url?: string };

/** Register REST routes for the singleton Brain repository. */
export async function brainRoutes(app: FastifyInstance, dataDir?: string) {
  app.get("/api/brain", async (_req, reply) => {
    const dir = dataDir ?? getDataDir();
    return reply.send(await loadBrainState(dir));
  });

  app.post<{ Body: BrainRequest }>("/api/brain", async (req, reply) => {
    const dir = dataDir ?? getDataDir();
    const body = (req.body ?? {}) as Partial<BrainRequest>;

    try {
      if (body.mode === "create") {
        if (!body.name?.trim()) throw new BadRequestError("name is required");
        const state = await createBrain(body.name, dir);
        return reply.status(201).send(state);
      }

      if (body.mode === "connect") {
        if (!body.url?.trim()) throw new BadRequestError("url is required");
        const state = await connectBrain(body.url, dir);
        return reply.status(201).send(state);
      }

      throw new BadRequestError("mode must be 'create' or 'connect'");
    } catch (err: unknown) {
      return reply
        .status(errorStatus(err, 400))
        .send({ error: errorMessage(err, "Brain setup failed") });
    }
  });

  app.delete("/api/brain", async (_req, reply) => {
    const dir = dataDir ?? getDataDir();
    try {
      await deleteBrain(dir);
      return reply.status(204).send();
    } catch (err: unknown) {
      return reply.status(errorStatus(err)).send({ error: errorMessage(err, "Failed to delete Brain") });
    }
  });

  // ── File operations (working tree — no commit) ──────────────────────

  app.get("/api/brain/files", async (_req, reply) => {
    const dir = dataDir ?? getDataDir();
    try {
      return reply.send(await listBrainFiles(dir));
    } catch (err: unknown) {
      return reply.status(errorStatus(err)).send({ error: errorMessage(err, "Failed to list Brain files") });
    }
  });

  app.get<{ Querystring: { path?: string } }>("/api/brain/file", async (req, reply) => {
    const dir = dataDir ?? getDataDir();
    try {
      if (!req.query.path) throw new BadRequestError("Missing 'path' query parameter");
      return reply.send(await readBrainFile(req.query.path, dir));
    } catch (err: unknown) {
      return reply.status(errorStatus(err)).send({ error: errorMessage(err, "Failed to read Brain file") });
    }
  });

  app.get<{ Querystring: { path?: string } }>("/api/brain/file/raw", async (req, reply) => {
    const dir = dataDir ?? getDataDir();
    try {
      if (!req.query.path) throw new BadRequestError("Missing 'path' query parameter");

      const file = await getBrainFileEntry(req.query.path, dir);
      reply.header("Cache-Control", "no-store");
      reply.header("Content-Type", rawFileContentType(file.path));
      reply.header("Content-Length", file.stat.size);
      reply.header("Content-Disposition", `inline; filename="${headerFilename(file.path)}"`);
      reply.header("X-Content-Type-Options", "nosniff");

      return reply.send(createReadStream(file.absolutePath));
    } catch (err: unknown) {
      return reply.status(errorStatus(err)).send({ error: errorMessage(err, "Failed to read Brain file") });
    }
  });

  app.put<{ Body: { path?: string; content?: string } }>("/api/brain/file", async (req, reply) => {
    const dir = dataDir ?? getDataDir();
    try {
      const { path, content } = req.body ?? {};
      if (!path) throw new BadRequestError("path is required");
      if (typeof content !== "string") throw new BadRequestError("content must be a string");
      return reply.send(await writeBrainFile(path, content, dir));
    } catch (err: unknown) {
      return reply.status(errorStatus(err)).send({ error: errorMessage(err, "Failed to write Brain file") });
    }
  });

  // ── Git operations (status / diff / save) ───────────────────────────

  app.get("/api/brain/status", async (_req, reply) => {
    const dir = dataDir ?? getDataDir();
    try {
      return reply.send(await getBrainStatus(dir));
    } catch (err: unknown) {
      return reply.status(errorStatus(err)).send({ error: errorMessage(err, "Failed to read Brain status") });
    }
  });

  app.get("/api/brain/diff", async (_req, reply) => {
    const dir = dataDir ?? getDataDir();
    try {
      return reply.send(await getBrainDiff(dir));
    } catch (err: unknown) {
      return reply.status(errorStatus(err)).send({ error: errorMessage(err, "Failed to compute Brain diff") });
    }
  });

  app.post<{ Body: { message?: string } }>("/api/brain/save", async (req, reply) => {
    const dir = dataDir ?? getDataDir();
    try {
      return reply.send(await saveBrain(req.body?.message, dir));
    } catch (err: unknown) {
      return reply.status(errorStatus(err)).send({ error: errorMessage(err, "Failed to save Brain") });
    }
  });
}
