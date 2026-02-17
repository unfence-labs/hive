import { PassThrough } from "node:stream";
import type { FastifyInstance } from "fastify";
import { scanConductor, importFromConductor, type ImportProgressEvent } from "../services/conductor-migrator.js";

export async function conductorRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/conductor/scan", async () => {
    return scanConductor();
  });

  app.post("/api/conductor/import", (req, reply) => {
    const stream = new PassThrough();

    void reply
      .header("Content-Type", "application/x-ndjson")
      .header("Cache-Control", "no-cache")
      .header("X-Accel-Buffering", "no")
      .send(stream);

    const sendEvent = (event: ImportProgressEvent) => {
      stream.write(JSON.stringify(event) + "\n");
    };

    importFromConductor(sendEvent)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        sendEvent({ type: "error", message });
      })
      .finally(() => stream.end());
  });
}
