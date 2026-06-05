import type { FastifyInstance } from "fastify";
import { createBrain, connectBrain, deleteBrain } from "../brain/brain-repo.js";
import { loadBrainState } from "../state/brain.js";
import { getDataDir } from "../state/state.js";
import { BadRequestError, errorMessage, errorStatus } from "../utils/errors.js";

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
    await deleteBrain(dir);
    return reply.status(204).send();
  });
}
