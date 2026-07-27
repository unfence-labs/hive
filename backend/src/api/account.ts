import type { FastifyInstance } from "fastify";
import { gh, isGhInstalled, _resetGhState } from "../utils/github.js";

/**
 * Connected-account identity. Connecting itself is a `gh` ToolAuthSession
 * driven by the setup routes; what lives here is reading who is signed in and
 * signing out.
 */

interface GitHubUser {
  login: string;
  name: string;
  email: string;
  avatarUrl: string;
}

async function fetchGitHubUser(): Promise<GitHubUser | null> {
  try {
    const { stdout } = await gh(["api", "user"]);
    const data = JSON.parse(stdout);
    return {
      login: data.login ?? "",
      name: data.name ?? "",
      email: data.email ?? "",
      avatarUrl: data.avatar_url ?? "",
    };
  } catch {
    return null;
  }
}

async function isGhAuthenticated(): Promise<boolean> {
  try {
    await gh(["auth", "status", "--hostname", "github.com"]);
    return true;
  } catch {
    return false;
  }
}

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/account/status", async () => {
    const installed = await isGhInstalled();
    if (!installed) {
      return { ghInstalled: false, authenticated: false };
    }

    const authenticated = await isGhAuthenticated();

    if (!authenticated) {
      return { ghInstalled: true, authenticated: false };
    }

    const user = await fetchGitHubUser();
    return { ghInstalled: true, authenticated: true, user };
  });

  app.post("/api/account/disconnect", async (_req, reply) => {
    try {
      // Need the username for non-interactive logout (no --yes flag exists)
      const user = await fetchGitHubUser();
      const args = ["auth", "logout", "--hostname", "github.com"];
      if (user?.login) args.push("--user", user.login);
      await gh(args);
      _resetGhState();
      return { ok: true };
    } catch (err: unknown) {
      const message = (err as Error).message ?? "Failed to disconnect";
      return reply.status(500).send({ error: message });
    }
  });
}
