import type { FastifyInstance } from "fastify";
import {
  isSetupToolId,
  SETUP_TOOL_IDS,
  TOOL_OPERATION_KINDS,
  type StartToolOperationResponse,
  type ToolOperationKind,
  type ToolsResponse,
} from "@hive/shared/setup-types";
import { findToolSpec, isManaged } from "../services/setup/catalog.js";
import {
  createToolOperationStore,
  type ToolOperationStore,
} from "../services/setup/operations.js";
import {
  defaultToolsServiceDeps,
  getToolsStatus,
  makeToolOperationRunner,
  type ToolsServiceDeps,
} from "../services/setup/tools-service.js";
import { getDataDir } from "../state/state.js";

export interface SetupRoutesOptions {
  dataDir?: string;
  deps?: ToolsServiceDeps;
  store?: ToolOperationStore;
}

/**
 * Tool detection, install and update.
 *
 * Operations are addressed individually at `/api/setup/operations/:id`, but
 * the tool listing carries them too. That redundancy is deliberate: a client
 * that reloads has no operation id to ask about, and the whole point is that
 * an install running for minutes survives the operator going elsewhere.
 */
export async function setupRoutes(
  app: FastifyInstance,
  opts: SetupRoutesOptions = {},
): Promise<void> {
  const deps = opts.deps ?? defaultToolsServiceDeps();
  const store =
    opts.store ??
    (await createToolOperationStore({
      dataDir: opts.dataDir ?? getDataDir(),
      onUnexpectedError: (operationId, error) => {
        app.log.error({ err: error }, `setup operation ${operationId} failed`);
      },
    }));

  app.get("/api/setup/tools", async (): Promise<ToolsResponse> => ({
    tools: await getToolsStatus(deps),
    operations: store.list(),
  }));

  app.post<{ Params: { tool: string; kind: ToolOperationKind } }>(
    "/api/setup/tools/:tool/:kind",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["tool", "kind"],
          properties: {
            tool: { type: "string", enum: [...SETUP_TOOL_IDS] },
            kind: { type: "string", enum: [...TOOL_OPERATION_KINDS] },
          },
        },
      },
    },
    async (req, reply): Promise<StartToolOperationResponse | undefined> => {
      const { tool, kind } = req.params;
      if (!isSetupToolId(tool)) {
        return reply.status(400).send({ error: "Unknown tool" });
      }
      const spec = findToolSpec(tool);
      if (!spec || !isManaged(spec)) {
        return reply.status(400).send({
          error: `Hive does not install ${spec?.label ?? tool} itself.`,
        });
      }

      return store.start(tool, kind, makeToolOperationRunner(spec, kind, deps));
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
          properties: { id: { type: "string", pattern: "^op-[A-Za-z0-9_-]{10}$" } },
        },
      },
    },
    async (req, reply) => {
      const operation = store.get(req.params.id);
      if (!operation) return reply.status(404).send({ error: "Operation not found" });
      return operation;
    },
  );
}
