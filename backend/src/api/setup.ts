import type { FastifyInstance } from "fastify";
import {
  SETUP_TOOL_IDS,
  TOOL_OPERATION_KINDS,
  type SetupStatusResponse,
  type SetupToolId,
  type StartToolOperationResponse,
  type ToolAuthSession,
  type ToolOperationKind,
  type ToolsResponse,
} from "@hive/shared/setup-types";
import { findToolSpec, isManaged } from "../services/setup/catalog.js";
import { ToolAuthError } from "../services/setup/auth/flow.js";
import {
  defaultToolAuthStore,
  type ToolAuthStore,
} from "../services/setup/auth/sessions.js";
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
  authStore?: ToolAuthStore;
}

const AUTH_TOOL_PARAMS = {
  type: "object",
  additionalProperties: false,
  required: ["tool"],
  properties: { tool: { type: "string", enum: [...SETUP_TOOL_IDS] } },
} as const;

/**
 * Tool detection, install, update and sign-in.
 *
 * Two reads on purpose: `/tools` runs the real detection probes, `/status`
 * answers from memory. A client polling for progress needs the operations and
 * sign-in sessions many times a minute, and none of that changes what is
 * installed — so progress polling must not spawn a probe per tick. Operations
 * have no per-id route: a client that reloads has no operation id to ask
 * about, and the whole point is that an install running for minutes survives
 * the operator going elsewhere. Sign-in sessions work the same way, with at
 * most one per tool.
 */
export async function setupRoutes(
  app: FastifyInstance,
  opts: SetupRoutesOptions = {},
): Promise<void> {
  const dataDir = opts.dataDir ?? getDataDir();
  const deps = opts.deps ?? defaultToolsServiceDeps();
  const store =
    opts.store ??
    (await createToolOperationStore({
      dataDir,
      onUnexpectedError: (operationId, error) => {
        app.log.error({ err: error }, `setup operation ${operationId} failed`);
      },
    }));
  const authStore =
    opts.authStore ??
    defaultToolAuthStore((tool, error) => {
      app.log.error({ err: error }, `setup auth lifecycle for ${tool} encountered an unexpected error`);
    });

  app.get("/api/setup/tools", async (): Promise<ToolsResponse> => ({
    tools: await getToolsStatus(deps),
    operations: store.list(),
    authSessions: authStore.list(),
  }));

  app.get("/api/setup/status", async (): Promise<SetupStatusResponse> => ({
    operations: store.list(),
    authSessions: authStore.list(),
  }));

  app.post<{ Params: { tool: SetupToolId; kind: ToolOperationKind } }>(
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
      const spec = findToolSpec(tool);
      if (!isManaged(spec)) {
        return reply.status(400).send({
          error: `Hive does not install ${spec.label} itself.`,
        });
      }

      return store.start(tool, kind, makeToolOperationRunner(spec, kind, deps));
    },
  );

  // ── Sign-in ────────────────────────────────────────────────────────

  app.post<{ Params: { tool: SetupToolId } }>(
    "/api/setup/auth/:tool/start",
    { schema: { params: AUTH_TOOL_PARAMS } },
    async (req, reply): Promise<ToolAuthSession | undefined> => {
      try {
        return await authStore.start(req.params.tool);
      } catch (error) {
        if (error instanceof ToolAuthError) {
          return reply.status(400).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { tool: SetupToolId }; Body: { code: string } }>(
    "/api/setup/auth/:tool/code",
    {
      schema: {
        params: AUTH_TOOL_PARAMS,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["code"],
          properties: { code: { type: "string", minLength: 1, maxLength: 2048 } },
        },
      },
    },
    async (req, reply): Promise<ToolAuthSession | undefined> => {
      try {
        return authStore.submitCode(req.params.tool, req.body.code.trim());
      } catch (error) {
        return reply
          .status(400)
          .send({ error: error instanceof Error ? error.message : "Invalid code" });
      }
    },
  );

  app.post<{ Params: { tool: SetupToolId } }>(
    "/api/setup/auth/:tool/cancel",
    { schema: { params: AUTH_TOOL_PARAMS } },
    async (req, reply): Promise<ToolAuthSession | undefined> => {
      const session = authStore.cancel(req.params.tool);
      if (!session) return reply.status(404).send({ error: "No sign-in to cancel" });
      return session;
    },
  );

}
