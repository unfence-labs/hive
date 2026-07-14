import type { FastifyInstance } from "fastify";
import { getWorkspace } from "../workspaces/workspace-manager.js";
import { broadcastToWorkspace } from "../ws/stream.js";
import { getDataDir } from "../state/state.js";
import { errorMessage } from "../utils/errors.js";
import {
  getDetectedPreviewUrl,
  getPreviewProxy,
  startPreviewProxy,
  stopPreviewProxy,
} from "../services/preview-proxy.js";
import type { PreviewStatusPayload } from "../types.js";

function previewStatus(wsId: string): PreviewStatusPayload {
  return {
    detectedUrl: getDetectedPreviewUrl(wsId),
    proxy: getPreviewProxy(wsId),
  };
}

export async function previewRoutes(app: FastifyInstance, dataDir?: string) {
  const dir = dataDir ?? getDataDir();

  async function workspaceExists(wsId: string): Promise<boolean> {
    return Boolean(await getWorkspace(wsId, dir));
  }

  // GET /api/workspaces/:wsId/preview — detected dev-server URL + proxy state
  app.get<{ Params: { wsId: string } }>(
    "/api/workspaces/:wsId/preview",
    async (req, reply) => {
      if (!(await workspaceExists(req.params.wsId))) {
        return reply.status(404).send({ error: "Workspace not found" });
      }
      return reply.send(previewStatus(req.params.wsId));
    },
  );

  // POST /api/workspaces/:wsId/preview/start — start (or retarget) the proxy
  app.post<{ Params: { wsId: string }; Body: { url?: string } | null }>(
    "/api/workspaces/:wsId/preview/start",
    async (req, reply) => {
      const { wsId } = req.params;
      if (!(await workspaceExists(wsId))) {
        return reply.status(404).send({ error: "Workspace not found" });
      }
      const url = req.body?.url?.trim() || getDetectedPreviewUrl(wsId);
      if (!url) {
        return reply.status(400).send({
          error: "No dev server URL. Start a run script or provide a URL.",
        });
      }
      try {
        await startPreviewProxy(wsId, url);
      } catch (err: unknown) {
        return reply.status(400).send({ error: errorMessage(err, "Failed to start preview") });
      }
      const status = previewStatus(wsId);
      broadcastToWorkspace(wsId, { type: "preview_status", status });
      return reply.send(status);
    },
  );

  // POST /api/workspaces/:wsId/preview/stop
  app.post<{ Params: { wsId: string } }>(
    "/api/workspaces/:wsId/preview/stop",
    async (req, reply) => {
      const { wsId } = req.params;
      stopPreviewProxy(wsId);
      const status = previewStatus(wsId);
      broadcastToWorkspace(wsId, { type: "preview_status", status });
      return reply.send(status);
    },
  );
}
