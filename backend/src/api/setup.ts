import type { FastifyInstance } from "fastify";
import type {
  RunSetupRequest,
  RunSetupResponse,
  SetupStatus,
} from "@hive/shared/setup-types";
import { getDataDir } from "../state/state.js";
import { detectTools } from "../services/setup/detect.js";
import {
  ConcurrentOperationError,
  createSetupOperationRunner,
  type RunnableStep,
} from "../services/setup/operations.js";
import {
  isValidClaudeToken,
  makeClaudeTokenWriter,
  type ClaudeTokenWriter,
} from "../services/setup/auth-flows.js";
import {
  SETUP_STEPS,
  type SetupStepDef,
} from "../services/setup/installers/index.js";

function resolveSteps(
  stepIds: string[],
  registry: Record<string, SetupStepDef>,
): RunnableStep[] | null {
  const steps: RunnableStep[] = [];
  for (const id of stepIds) {
    if (!Object.hasOwn(registry, id)) return null;
    const definition = registry[id];
    steps.push({ id, title: definition.title, fn: definition.fn });
  }
  return steps;
}

export interface SetupRoutesOptions {
  dataDir?: string;
  claudeTokenWriter?: ClaudeTokenWriter;
  steps?: Record<string, SetupStepDef>;
}

function hasExactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export async function setupRoutes(
  app: FastifyInstance,
  opts: SetupRoutesOptions = {},
): Promise<void> {
  const dataDir = opts.dataDir ?? getDataDir();
  const claudeTokenWriter = opts.claudeTokenWriter ?? makeClaudeTokenWriter(dataDir);
  const stepRegistry = opts.steps ?? SETUP_STEPS;
  const stepIds = Object.keys(stepRegistry);
  const runner = createSetupOperationRunner({
    onUnexpectedError: (operationId, error) => {
      app.log.error({ err: error }, `setup operation ${operationId} failed`);
    },
  });

  app.get("/api/setup/status", async (): Promise<SetupStatus> => ({
    detected: await detectTools(),
  }));

  app.post<{ Body: RunSetupRequest }>(
    "/api/setup/run",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["steps"],
          properties: {
            steps: {
              type: "array",
              minItems: 1,
              uniqueItems: true,
              items: { type: "string", enum: stepIds },
            },
          },
        },
      },
      preValidation: async (req, reply) => {
        if (!hasExactKeys(req.body, ["steps"])) {
          return reply.status(400).send({ error: "Invalid setup steps" });
        }
        const requested = req.body.steps;
        if (
          !Array.isArray(requested) ||
          requested.length === 0 ||
          requested.some((id) => typeof id !== "string" || !Object.hasOwn(stepRegistry, id)) ||
          new Set(requested).size !== requested.length
        ) {
          return reply.status(400).send({ error: "Invalid setup steps" });
        }
      },
    },
    async (req, reply) => {
      const steps = resolveSteps(req.body.steps, stepRegistry);
      if (!steps) return reply.status(400).send({ error: "Unknown setup step" });

      try {
        const operation = runner.start(steps);
        const response: RunSetupResponse = { operationId: operation.id };
        return response;
      } catch (error) {
        if (error instanceof ConcurrentOperationError) {
          return reply.status(409).send({
            code: "CONCURRENT_RUN",
            error: "A requested step is already running",
            operationId: error.existingOperationId,
          });
        }
        throw error;
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/setup/operations/:id",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: {
            id: { type: "string", pattern: "^op-[A-Za-z0-9_-]{8}$" },
          },
        },
      },
    },
    async (req, reply) => {
      const operation = runner.get(req.params.id);
      if (!operation) return reply.status(404).send({ error: "Operation not found" });
      return operation;
    },
  );

  app.post<{ Body: { token: string } }>(
    "/api/setup/auth/claude/token",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["token"],
          properties: { token: { type: "string", minLength: 1 } },
        },
      },
      preValidation: async (req, reply) => {
        if (!hasExactKeys(req.body, ["token"]) || typeof req.body.token !== "string") {
          return reply.status(400).send({ error: "Invalid Claude token" });
        }
      },
    },
    async (req, reply) => {
      const token = req.body.token.trim();
      if (!isValidClaudeToken(token)) {
        return reply.status(400).send({ error: "Invalid Claude token format" });
      }
      await claudeTokenWriter(token);
      return { ok: true };
    },
  );
}
