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
  type StepFn,
} from "../services/setup/operations.js";
import {
  isValidClaudeToken,
  defaultClaudeTokenWriter,
  type ClaudeTokenWriter,
} from "../services/setup/auth-flows.js";

/**
 * Registry of runnable setup steps. Real installers land in later PRs (§6.3);
 * for now each step emits a couple of log lines and succeeds so the engine and
 * REST surface are exercisable end to end.
 */
interface StepDef {
  title: string;
  fn: StepFn;
}

function stubStep(title: string): StepDef {
  return {
    title,
    fn: async (emit) => {
      await emit({ stream: "system", line: `${title}: starting` });
      await emit({ stream: "stdout", line: `${title}: done` });
    },
  };
}

const STEP_REGISTRY: Record<string, StepDef> = {
  detect: stubStep("Detect tools"),
  install_claude: stubStep("Install Claude Code"),
  auth_claude: stubStep("Authenticate Claude"),
  install_codex: stubStep("Install Codex"),
  auth_codex: stubStep("Authenticate Codex"),
  install_gh: stubStep("Install GitHub CLI"),
  auth_gh: stubStep("Authenticate GitHub"),
  install_mise: stubStep("Install mise"),
  install_uv: stubStep("Install uv"),
  install_docker: stubStep("Install Docker (rootless)"),
  verify: stubStep("Verify installation"),
};

function resolveSteps(stepIds: string[]): { steps: RunnableStep[]; unknown: string[] } {
  const steps: RunnableStep[] = [];
  const unknown: string[] = [];
  for (const id of stepIds) {
    const def = STEP_REGISTRY[id];
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
}

export async function setupRoutes(
  app: FastifyInstance,
  opts: SetupRoutesOptions = {},
): Promise<void> {
  const dataDir = opts.dataDir ?? getDataDir();
  const claudeTokenWriter = opts.claudeTokenWriter ?? defaultClaudeTokenWriter;

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

    const { steps, unknown } = resolveSteps(stepIds);
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
      const { steps, unknown } = resolveSteps(op.steps.map((s) => s.id));
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
