import { basename } from "node:path";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import type { FastifyInstance, FastifyReply } from "fastify";
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
import {
  truncateMessageForHistory,
  selectMessageWindow,
  findFullOutputById,
} from "../agents/session-utils.js";
import type { ChatMessage } from "../types.js";
import type { SessionOptions } from "../agents/agent-manager.js";
import { errorMessage, errorStatus } from "../utils/errors.js";

/** Default page size for the REST message history (PRD #254). */
const DEFAULT_MESSAGE_LIMIT = 200;

/** Upper bound on a single history page so a client can't request an unbounded page. */
const MAX_MESSAGE_LIMIT = 1000;

/** Parse the `limit`/`before` history query, clamping `limit` to a sane range. */
function parseHistoryQuery(query: { limit?: string; before?: string }): {
  limit: number;
  before?: string;
} {
  const parsed = Number(query.limit);
  const limit = Number.isFinite(parsed) && parsed > 0
    ? Math.min(Math.floor(parsed), MAX_MESSAGE_LIMIT)
    : DEFAULT_MESSAGE_LIMIT;
  const before = query.before && query.before.length > 0 ? query.before : undefined;
  return { limit, before };
}

/**
 * Serialize a full (disk-read) message list as the REST history response:
 * select the `limit`/`before` window, truncate every heavy tool/activity output
 * to preview + scalars, and send `{ messages, hasMore }`. The single
 * serialization boundary shared by the active- and explicit-session routes — it
 * transforms copies only, never the persisted data.
 */
function sendMessageHistory(
  reply: FastifyReply,
  fullMessages: ChatMessage[],
  query: { limit?: string; before?: string },
) {
  const { limit, before } = parseHistoryQuery(query);
  const window = selectMessageWindow(fullMessages, limit, before);
  return reply.send({
    messages: window.messages.map(truncateMessageForHistory),
    hasMore: window.hasMore,
  });
}

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

  // GET /api/workspaces/:wsId/session/messages — active-session history.
  // Resolves the active sessionId internally, then delegates to the same
  // window+truncate serialization as the explicit-session route.
  app.get<{ Params: { wsId: string }; Querystring: { limit?: string; before?: string } }>(
    "/api/workspaces/:wsId/session/messages",
    async (req, reply) => {
      try {
        const messages = await getSessionMessages(req.params.wsId, dataDir);
        return sendMessageHistory(reply, messages, req.query);
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
        return reply.status(204).send();
      } catch (err: unknown) {
        const msg = errorMessage(err, "Failed to delete session");
        const code = errorStatus(err);
        return reply.status(code).send({ error: msg });
      }
    },
  );

  // GET /api/workspaces/:wsId/sessions/:sessionId/messages — explicit-session
  // history with `?limit`/`?before`, returning `{ messages, hasMore }` with
  // heavy tool/activity outputs truncated to preview + scalars.
  app.get<{
    Params: { wsId: string; sessionId: string };
    Querystring: { limit?: string; before?: string };
  }>(
    "/api/workspaces/:wsId/sessions/:sessionId/messages",
    async (req, reply) => {
      try {
        const messages = await getSpecificSessionMessages(
          req.params.wsId,
          req.params.sessionId,
          dataDir,
        );
        return sendMessageHistory(reply, messages, req.query);
      } catch (err: unknown) {
        const msg = errorMessage(err, "Failed to load session messages");
        const code = errorStatus(err);
        return reply.status(code).send({ error: msg });
      }
    },
  );

  // GET /api/workspaces/:wsId/sessions/:sessionId/tools/:toolId/output —
  // fetch the FULL, untruncated output for a tool call OR a heavy agent-activity
  // field (command output / file diff) by id, read from disk on expand.
  // Resolves both tool and activity ids through the one scan (no duplication).
  app.get<{ Params: { wsId: string; sessionId: string; toolId: string } }>(
    "/api/workspaces/:wsId/sessions/:sessionId/tools/:toolId/output",
    async (req, reply) => {
      try {
        const { sessionId, toolId } = req.params;
        // Guard the path segments against traversal before they reach the
        // session-dir join (mirrors the attachment route's filename guard).
        if (sessionId !== basename(sessionId) || sessionId.includes("..")) {
          return reply.status(400).send({ error: "Invalid session id" });
        }
        if (toolId.includes("/") || toolId.includes("..")) {
          return reply.status(400).send({ error: "Invalid tool id" });
        }
        const messages = await getSpecificSessionMessages(
          req.params.wsId,
          sessionId,
          dataDir,
        );
        // No session on disk yields an empty list; treat a missing id alike.
        const output = findFullOutputById(messages, req.params.toolId);
        if (output === undefined) {
          return reply.status(404).send({ error: "Tool output not found" });
        }
        return reply.send({ output });
      } catch (err: unknown) {
        const msg = errorMessage(err, "Failed to load tool output");
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
