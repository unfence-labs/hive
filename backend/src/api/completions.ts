import type { FastifyInstance } from "fastify";
import { resolveChatCwd } from "../agents/chat-context.js";
import { scanCompletions, type CompletionProvider } from "../utils/completion-scanner.js";
import { getDataDir } from "../state/state.js";
import { errorMessage, errorStatus } from "../utils/errors.js";

export async function completionRoutes(
  app: FastifyInstance,
  dataDir?: string,
) {
  app.get<{ Params: { wsId: string }; Querystring: { provider?: string } }>(
    "/api/workspaces/:wsId/completions",
    async (req, reply) => {
      try {
        const provider = parseCompletionProvider(req.query.provider);
        if (!provider) {
          return reply.status(400).send({ error: "Unsupported completion provider" });
        }

        const dir = dataDir ?? getDataDir();
        const workspaceCwd = await resolveChatCwd(req.params.wsId, dir);
        if (!workspaceCwd) {
          return reply.status(404).send({ error: "Workspace not found" });
        }

        const items = await scanCompletions(workspaceCwd, { provider });
        return reply.send({ items });
      } catch (err: unknown) {
        return reply
          .status(errorStatus(err))
          .send({ error: errorMessage(err, "Failed to scan completions") });
      }
    },
  );
}

function parseCompletionProvider(value: string | undefined): CompletionProvider | null {
  // Kimi rides the Claude CLI, so its skills/agents live in the claude scan.
  if (value === undefined || value === "" || value === "claude" || value === "kimi") return "claude";
  if (value === "codex") return "codex";
  return null;
}
