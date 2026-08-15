import { basename } from "node:path";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import sharp from "sharp";
import type { FastifyInstance } from "fastify";
import {
  getOrCreateSession,
  getSessionMetadata,
  endSession,
  getSessionMessages,
  listWorkspaceSessions,
  createNewSession,
  convertSessionToTerminal,
  hardDeleteSession,
  getSpecificSessionMessages,
  resolveSessionAttachmentPath,
} from "../agents/session-dispatch.js";
import type { SessionOptions } from "../agents/agent-manager.js";
import { errorMessage, errorStatus } from "../utils/errors.js";
import { broadcastUnreadState } from "../ws/stream.js";

export interface SessionRoutesOptions {
  dataDir?: string;
  sessionOptions?: SessionOptions;
}

export async function sessionRoutes(app: FastifyInstance, opts: SessionRoutesOptions = {}) {
  const { dataDir, sessionOptions } = opts;

  // POST /api/workspaces/:wsId/session — create/resume session
  app.post<{ Params: { wsId: string } }>(
    "/api/workspaces/:wsId/session",
    async (req, reply) => {
      try {
        const { session, created } = await getOrCreateSession(
          req.params.wsId,
          dataDir,
          sessionOptions,
        );
        const status = created ? 201 : 200;
        return reply.status(status).send(session.metadata);
      } catch (err: unknown) {
        const msg = errorMessage(err, "Failed to create session");
        const code = errorStatus(err);
        return reply.status(code).send({ error: msg });
      }
    },
  );

  // GET /api/workspaces/:wsId/session — get session metadata
  app.get<{ Params: { wsId: string } }>(
    "/api/workspaces/:wsId/session",
    async (req, reply) => {
      const meta = getSessionMetadata(req.params.wsId);
      if (!meta) {
        return reply.status(404).send({ error: "No active session" });
      }
      return reply.send(meta);
    },
  );

  // GET /api/workspaces/:wsId/session/messages — get persisted messages
  app.get<{ Params: { wsId: string } }>(
    "/api/workspaces/:wsId/session/messages",
    async (req, reply) => {
      try {
        const messages = await getSessionMessages(req.params.wsId, dataDir);
        return reply.send(messages);
      } catch (err: unknown) {
        const msg = errorMessage(err, "Failed to load session messages");
        const code = errorStatus(err);
        return reply.status(code).send({ error: msg });
      }
    },
  );

  // DELETE /api/workspaces/:wsId/session — end session
  app.delete<{ Params: { wsId: string } }>(
    "/api/workspaces/:wsId/session",
    async (req, reply) => {
      try {
        await endSession(req.params.wsId, dataDir);
        return reply.status(204).send();
      } catch (err: unknown) {
        const msg = errorMessage(err, "Failed to end session");
        const code = errorStatus(err);
        return reply.status(code).send({ error: msg });
      }
    },
  );

  // ── Multi-session routes ──────────────────────────────────────────

  // GET /api/workspaces/:wsId/sessions — list all sessions
  app.get<{ Params: { wsId: string } }>(
    "/api/workspaces/:wsId/sessions",
    async (req, reply) => {
      try {
        const sessions = await listWorkspaceSessions(req.params.wsId, dataDir);
        return reply.send(sessions);
      } catch (err: unknown) {
        const msg = errorMessage(err, "Failed to list sessions");
        const code = errorStatus(err);
        return reply.status(code).send({ error: msg });
      }
    },
  );

  // POST /api/workspaces/:wsId/sessions — create a new session (parks current)
  app.post<{ Params: { wsId: string }; Body?: { kind?: string } }>(
    "/api/workspaces/:wsId/sessions",
    async (req, reply) => {
      try {
        // Only "terminal" is accepted from the body; anything else is a chat.
        const kind = req.body?.kind === "terminal" ? "terminal" : "chat";
        const session = await createNewSession(req.params.wsId, dataDir, sessionOptions, kind);
        return reply.status(201).send(session.metadata);
      } catch (err: unknown) {
        const msg = errorMessage(err, "Failed to create session");
        const code = errorStatus(err);
        return reply.status(code).send({ error: msg });
      }
    },
  );

  // POST /api/workspaces/:wsId/sessions/:sessionId/convert-to-terminal —
  // turn an empty chat session into a terminal session in place (irreversible).
  app.post<{ Params: { wsId: string; sessionId: string } }>(
    "/api/workspaces/:wsId/sessions/:sessionId/convert-to-terminal",
    async (req, reply) => {
      try {
        const meta = await convertSessionToTerminal(
          req.params.wsId,
          req.params.sessionId,
          dataDir,
        );
        await broadcastUnreadState(req.params.wsId, dataDir).catch((err) => {
          req.log.error({ err, wsId: req.params.wsId }, "Unread state broadcast failed");
        });
        return reply.send(meta);
      } catch (err: unknown) {
        const msg = errorMessage(err, "Failed to convert session to terminal");
        const code = errorStatus(err);
        return reply.status(code).send({ error: msg });
      }
    },
  );

  // DELETE /api/workspaces/:wsId/sessions/:sessionId — hard delete a session
  app.delete<{ Params: { wsId: string; sessionId: string } }>(
    "/api/workspaces/:wsId/sessions/:sessionId",
    async (req, reply) => {
      try {
        await hardDeleteSession(req.params.wsId, req.params.sessionId, dataDir);
        await broadcastUnreadState(req.params.wsId, dataDir).catch((err) => {
          req.log.error({ err, wsId: req.params.wsId }, "Unread state broadcast failed");
        });
        return reply.status(204).send();
      } catch (err: unknown) {
        const msg = errorMessage(err, "Failed to delete session");
        const code = errorStatus(err);
        return reply.status(code).send({ error: msg });
      }
    },
  );

  // GET /api/workspaces/:wsId/sessions/:sessionId/messages — get messages for a specific session
  app.get<{ Params: { wsId: string; sessionId: string }; Querystring: { since?: string } }>(
    "/api/workspaces/:wsId/sessions/:sessionId/messages",
    async (req, reply) => {
      try {
        const messages = await getSpecificSessionMessages(
          req.params.wsId,
          req.params.sessionId,
          dataDir,
        );
        const since = req.query.since;
        if (since) {
          const idx = messages.findIndex((m) => m.id === since);
          if (idx >= 0) return reply.send(messages.slice(idx + 1));
        }
        return reply.send(messages);
      } catch (err: unknown) {
        const msg = errorMessage(err, "Failed to load session messages");
        const code = errorStatus(err);
        return reply.status(code).send({ error: msg });
      }
    },
  );

  // GET /api/workspaces/:wsId/sessions/:sessionId/attachments/:filename — serve image attachment
  app.get<{ Params: { wsId: string; sessionId: string; filename: string }; Querystring: { w?: string } }>(
    "/api/workspaces/:wsId/sessions/:sessionId/attachments/:filename",
    async (req, reply) => {
      try {
        const { filename } = req.params;
        // Guard against path traversal
        if (filename !== basename(filename) || filename.includes("..")) {
          return reply.status(400).send({ error: "Invalid filename" });
        }
        const filePath = await resolveSessionAttachmentPath(
          req.params.wsId,
          req.params.sessionId,
          filename,
          dataDir,
        );
        if (!filePath || !existsSync(filePath)) {
          return reply.status(404).send({ error: "Attachment not found" });
        }
        const info = await stat(filePath);
        const ext = filename.split(".").pop()?.toLowerCase();
        const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg"
          : ext === "png" ? "image/png"
          : ext === "webp" ? "image/webp"
          : ext === "gif" ? "image/gif"
          : "application/octet-stream";
        const width = req.query.w ? Number.parseInt(req.query.w, 10) : undefined;
        if (width && width > 0 && width <= 2048 && mime.startsWith("image/") && mime !== "image/gif") {
          const resized = await sharp(filePath)
            .resize(width, undefined, { withoutEnlargement: true })
            .toBuffer();
          reply.header("Content-Type", mime);
          reply.header("Content-Length", resized.length);
          reply.header("Cache-Control", "public, max-age=31536000, immutable");
          return reply.send(resized);
        }
        reply.header("Content-Type", mime);
        reply.header("Content-Length", info.size);
        reply.header("Cache-Control", "public, max-age=31536000, immutable");
        return reply.send(createReadStream(filePath));
      } catch (err: unknown) {
        const msg = errorMessage(err, "Failed to serve attachment");
        const code = errorStatus(err);
        return reply.status(code).send({ error: msg });
      }
    },
  );
}
