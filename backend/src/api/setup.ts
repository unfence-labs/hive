import type { FastifyInstance } from "fastify";
import type {
  SetupStatus,
  RunSetupRequest,
  RunSetupResponse,
} from "@hive/shared/setup-types";
import { getDataDir } from "../state/state.js";
import { detectTools } from "../services/setup/detect.js";
import {
  createOperation,
  getOperation,
  listOperations,
  readLogSince,
  runOperation,
  findRunningOperation,
  type RunnableStep,
} from "../services/setup/operations.js";
import {
  isValidClaudeToken,
  defaultClaudeTokenWriter,
  type ClaudeTokenWriter,
} from "../services/setup/auth-flows.js";
import {
  SETUP_STEPS,
  type SetupStepDef,
} from "../services/setup/installers/index.js";

function resolveSteps(
  stepIds: string[],
  registry: Record<string, SetupStepDef>,
): { steps: RunnableStep[]; unknown: string[] } {
  const steps: RunnableStep[] = [];
  const unknown: string[] = [];
  for (const id of stepIds) {
    const def = registry[id];
    if (!def) {
      unknown.push(id);
      continue;
    }
    steps.push({ id, title: def.title, fn: def.fn });
  }
  return { steps, unknown };
}

export interface SetupRoutesOptions {
  dataDir?: string;
  /** Injectable Claude token writer (§6.4); defaults to the env-file writer. */
  claudeTokenWriter?: ClaudeTokenWriter;
  /** Injectable step registry; defaults to the real installer steps. */
  steps?: Record<string, SetupStepDef>;
}

export async function setupRoutes(
  app: FastifyInstance,
  opts: SetupRoutesOptions = {},
): Promise<void> {
  const dataDir = opts.dataDir ?? getDataDir();
  const claudeTokenWriter = opts.claudeTokenWriter ?? defaultClaudeTokenWriter;
  const stepRegistry = opts.steps ?? SETUP_STEPS;

  app.get("/api/setup/status", async (): Promise<SetupStatus> => {
    const [detected, operations] = await Promise.all([
      detectTools(),
      listOperations(dataDir),
    ]);
    return { detected, operations };
  });

  app.post("/api/setup/run", async (req, reply) => {
    const body = (req.body ?? {}) as RunSetupRequest;
    const stepIds = Array.isArray(body.steps) ? body.steps : [];
    if (stepIds.length === 0) {
      return reply.status(400).send({ error: "No steps provided" });
    }

    const { steps, unknown } = resolveSteps(stepIds, stepRegistry);
    if (unknown.length > 0) {
      return reply.status(400).send({ error: `Unknown steps: ${unknown.join(", ")}` });
    }

    const running = await findRunningOperation("guided-setup", dataDir);
    if (running) {
      return reply.status(409).send({ error: "Another setup operation is already running", operationId: running });
    }

    const op = await createOperation(
      "guided-setup",
      steps.map((s) => ({ id: s.id, title: s.title })),
      dataDir,
    );

    // Fire and forget: the operation runs in-process; clients poll for progress.
    void runOperation(op.id, steps, dataDir).catch((err) => {
      req.log.error({ err }, `setup operation ${op.id} failed to run`);
    });

    const response: RunSetupResponse = { operationId: op.id };
    return response;
  });

  app.get<{ Params: { id: string } }>("/api/setup/operations/:id", async (req, reply) => {
    const op = await getOperation(req.params.id, dataDir);
    if (!op) return reply.status(404).send({ error: "Operation not found" });
    return op;
  });

  app.get<{ Params: { id: string }; Querystring: { since?: string } }>(
    "/api/setup/operations/:id/log",
    async (req, reply) => {
      const op = await getOperation(req.params.id, dataDir);
      if (!op) return reply.status(404).send({ error: "Operation not found" });

      const since = Number.parseInt(req.query.since ?? "", 10);
      const sinceSeq = Number.isFinite(since) ? since : -1;
      const lines = await readLogSince(req.params.id, sinceSeq, dataDir);

      reply.header("content-type", "application/x-ndjson");
      return lines.map((l) => JSON.stringify(l)).join("\n");
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/setup/operations/:id/retry",
    async (req, reply) => {
      const op = await getOperation(req.params.id, dataDir);
      if (!op) return reply.status(404).send({ error: "Operation not found" });

      // Rebuild the runnable steps for this op from the registry; retry re-runs
      // from the first non-succeeded step (runOperation skips succeeded ones).
      const { steps, unknown } = resolveSteps(op.steps.map((s) => s.id), stepRegistry);
      if (unknown.length > 0) {
        return reply.status(409).send({ error: `Operation references unknown steps: ${unknown.join(", ")}` });
      }

      const running = await findRunningOperation(op.kind, dataDir);
      if (running && running !== op.id) {
        return reply.status(409).send({ error: "Another setup operation is already running", operationId: running });
      }

      void runOperation(op.id, steps, dataDir).catch((err) => {
        req.log.error({ err }, `setup operation ${op.id} retry failed`);
      });

      const response: RunSetupResponse = { operationId: op.id };
      return response;
    },
  );

  app.post<{ Body: { token?: string } }>(
    "/api/setup/auth/claude/token",
    async (req, reply) => {
      const token = (req.body?.token ?? "").trim();
      if (!isValidClaudeToken(token)) {
        return reply.status(400).send({ error: "Invalid Claude token format" });
      }
      const { persisted } = await claudeTokenWriter(token);
      return { ok: true, persisted };
    },
  );
}
