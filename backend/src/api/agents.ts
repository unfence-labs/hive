import type { FastifyInstance } from "fastify";
import {
  getOrCreateSession,
  getSessionMetadata,
  endSession,
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
      const { getSession } = await import("../agents/agent-manager.js");
      const session = getSession(req.params.wsId);
      if (!session) {
        return reply.status(404).send({ error: "No active session" });
      }
      const messages = await session.getMessages();
      return reply.send(messages);
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
}
