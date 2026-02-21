import { basename } from "node:path";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import {
  getOrCreateSession,
  getSessionMetadata,
  endSession,
  getSessionMessages,
  listWorkspaceSessions,
  createNewSession,
  activateSession,
  hardDeleteSession,
  getSpecificSessionMessages,
  resolveSessionAttachmentPath,
  type SessionOptions,
} from "../agents/agent-manager.js";
import { errorMessage, errorStatus } from "../utils/errors.js";

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
  app.post<{ Params: { wsId: string } }>(
    "/api/workspaces/:wsId/sessions",
    async (req, reply) => {
      try {
        const session = await createNewSession(req.params.wsId, dataDir, sessionOptions);
        return reply.status(201).send(session.metadata);
      } catch (err: unknown) {
        const msg = errorMessage(err, "Failed to create session");
        const code = errorStatus(err);
        return reply.status(code).send({ error: msg });
      }
    },
  );

  // POST /api/workspaces/:wsId/sessions/:sessionId/activate — switch to a session
  app.post<{ Params: { wsId: string; sessionId: string } }>(
    "/api/workspaces/:wsId/sessions/:sessionId/activate",
    async (req, reply) => {
      try {
        const session = await activateSession(
          req.params.wsId,
          req.params.sessionId,
          dataDir,
          sessionOptions,
        );
        return reply.send(session.metadata);
      } catch (err: unknown) {
        const msg = errorMessage(err, "Failed to activate session");
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
        return reply.status(204).send();
      } catch (err: unknown) {
        const msg = errorMessage(err, "Failed to delete session");
        const code = errorStatus(err);
        return reply.status(code).send({ error: msg });
      }
    },
  );

  // GET /api/workspaces/:wsId/sessions/:sessionId/messages — get messages for a specific session
  app.get<{ Params: { wsId: string; sessionId: string } }>(
    "/api/workspaces/:wsId/sessions/:sessionId/messages",
    async (req, reply) => {
      try {
        const messages = await getSpecificSessionMessages(
          req.params.wsId,
          req.params.sessionId,
          dataDir,
        );
        return reply.send(messages);
      } catch (err: unknown) {
        const msg = errorMessage(err, "Failed to load session messages");
        const code = errorStatus(err);
        return reply.status(code).send({ error: msg });
      }
    },
  );

  // GET /api/workspaces/:wsId/sessions/:sessionId/attachments/:filename — serve image attachment
  app.get<{ Params: { wsId: string; sessionId: string; filename: string } }>(
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
