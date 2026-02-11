import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { projectRoutes } from "./api/projects.js";
import { workspaceRoutes } from "./api/workspaces.js";
import { sessionRoutes } from "./api/agents.js";
import { streamRoutes } from "./ws/stream.js";
import { createAuthHook } from "./utils/auth.js";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3000);

export async function buildApp() {
  const authToken = process.env.HIVE_AUTH_TOKEN?.trim();
  const app = Fastify({ logger: true });
  await app.register(websocket);

  app.addHook("onRequest", createAuthHook(authToken));

  app.get("/health", async () => ({ status: "ok" }));

  await app.register((instance: FastifyInstance) => projectRoutes(instance));
  await app.register((instance: FastifyInstance) => workspaceRoutes(instance));
  await app.register((instance: FastifyInstance) => sessionRoutes(instance));
  await app.register((instance: FastifyInstance) => streamRoutes(instance, { authToken }));

  return app;
}

async function main() {
  const app = await buildApp();
  await app.listen({ host: HOST, port: PORT });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
