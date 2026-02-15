import type { FastifyInstance } from "fastify";
import { join } from "node:path";
import { getWorkspace } from "../workspaces/workspace-manager.js";
import { workspacesDir } from "../utils/paths.js";
import { scanCompletions } from "../utils/completion-scanner.js";
import { getDataDir } from "../state/state.js";
import { errorMessage, errorStatus } from "../utils/errors.js";

export async function completionRoutes(
  app: FastifyInstance,
  dataDir?: string,
) {
  app.get<{ Params: { wsId: string } }>(
    "/api/workspaces/:wsId/completions",
    async (req, reply) => {
      try {
        const dir = dataDir ?? getDataDir();
        const result = await getWorkspace(req.params.wsId, dir);
        if (!result) {
          return reply.status(404).send({ error: "Workspace not found" });
        }

        const workspaceCwd = join(
          workspacesDir(dir, result.projectState.id),
          result.workspace.name,
        );

        const items = await scanCompletions(workspaceCwd);
        return reply.send({ items });
      } catch (err: unknown) {
        return reply
          .status(errorStatus(err))
          .send({ error: errorMessage(err, "Failed to scan completions") });
      }
    },
  );
}
