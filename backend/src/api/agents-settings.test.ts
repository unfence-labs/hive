import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

const mocks = vi.hoisted(() => ({
  getAllProviderInfo: vi.fn(),
}));

vi.mock("../agents/providers/registry.js", () => ({
  getAllProviderInfo: mocks.getAllProviderInfo,
}));

import { agentSettingsRoutes } from "./agents-settings.js";

let app: ReturnType<typeof Fastify>;
const originalFetch = globalThis.fetch;

beforeEach(async () => {
  app = Fastify();
  await app.register((instance: FastifyInstance) => agentSettingsRoutes(instance));
  await app.ready();
});

afterEach(async () => {
  await app.close();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function mockFetchNpm(versions: Record<string, string | null>) {
  globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    for (const [pkg, version] of Object.entries(versions)) {
      if (url.includes(encodeURIComponent(pkg)) || url.includes(pkg)) {
        if (version === null) {
          return new Response("Not Found", { status: 404 });
        }
        return new Response(JSON.stringify({ version }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    return new Response("Not Found", { status: 404 });
  }) as typeof fetch;
}

describe("GET /api/settings/agents", () => {
  it("returns all providers with correct shape", async () => {
    mocks.getAllProviderInfo.mockReturnValue([
      { id: "claude", label: "Claude Code", npmPackage: "@anthropic-ai/claude-code", installed: true, version: "1.0.35" },
      { id: "codex", label: "Codex", npmPackage: "@openai/codex", installed: false, version: null },
    ]);
    mockFetchNpm({ "@anthropic-ai/claude-code": "1.0.35", "@openai/codex": "0.2.0" });

    const res = await app.inject({ method: "GET", url: "/api/settings/agents" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.agents).toHaveLength(2);
    expect(body.agents[0]).toEqual({
      id: "claude",
      label: "Claude Code",
      installed: true,
      version: "1.0.35",
      latestVersion: "1.0.35",
      updateAvailable: false,
    });
    expect(body.agents[1]).toEqual({
      id: "codex",
      label: "Codex",
      installed: false,
      version: null,
      latestVersion: "0.2.0",
      updateAvailable: false,
    });
  });

  it("sets updateAvailable true when npm version is newer", async () => {
    mocks.getAllProviderInfo.mockReturnValue([
      { id: "claude", label: "Claude Code", npmPackage: "@anthropic-ai/claude-code", installed: true, version: "1.0.30" },
    ]);
    mockFetchNpm({ "@anthropic-ai/claude-code": "1.0.35" });

    const res = await app.inject({ method: "GET", url: "/api/settings/agents" });
    const body = res.json();

    expect(body.agents[0].updateAvailable).toBe(true);
    expect(body.agents[0].latestVersion).toBe("1.0.35");
  });

  it("sets updateAvailable false when versions match", async () => {
    mocks.getAllProviderInfo.mockReturnValue([
      { id: "claude", label: "Claude Code", npmPackage: "@anthropic-ai/claude-code", installed: true, version: "1.0.35" },
    ]);
    mockFetchNpm({ "@anthropic-ai/claude-code": "1.0.35" });

    const res = await app.inject({ method: "GET", url: "/api/settings/agents" });
    expect(res.json().agents[0].updateAvailable).toBe(false);
  });

  it("handles npm registry failure gracefully", async () => {
    mocks.getAllProviderInfo.mockReturnValue([
      { id: "claude", label: "Claude Code", npmPackage: "@anthropic-ai/claude-code", installed: true, version: "1.0.35" },
    ]);
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network error");
    }) as typeof fetch;

    const res = await app.inject({ method: "GET", url: "/api/settings/agents" });
    const agent = res.json().agents[0];

    expect(agent.latestVersion).toBeNull();
    expect(agent.updateAvailable).toBe(false);
  });

  it("handles npm registry 404 gracefully", async () => {
    mocks.getAllProviderInfo.mockReturnValue([
      { id: "claude", label: "Claude Code", npmPackage: "@anthropic-ai/claude-code", installed: true, version: "1.0.35" },
    ]);
    mockFetchNpm({ "@anthropic-ai/claude-code": null });

    const res = await app.inject({ method: "GET", url: "/api/settings/agents" });
    const agent = res.json().agents[0];

    expect(agent.latestVersion).toBeNull();
    expect(agent.updateAvailable).toBe(false);
  });

  it("handles provider with empty npm package name", async () => {
    mocks.getAllProviderInfo.mockReturnValue([
      { id: "custom", label: "Custom", npmPackage: "", installed: true, version: "1.0.0" },
    ]);
    globalThis.fetch = vi.fn(async () => {
      throw new Error("fetch should not be called");
    }) as typeof fetch;

    const res = await app.inject({ method: "GET", url: "/api/settings/agents" });
    const agent = res.json().agents[0];

    expect(agent.latestVersion).toBeNull();
    expect(agent.updateAvailable).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("non-installed providers always have updateAvailable false", async () => {
    mocks.getAllProviderInfo.mockReturnValue([
      { id: "codex", label: "Codex", npmPackage: "@openai/codex", installed: false, version: null },
    ]);
    mockFetchNpm({ "@openai/codex": "0.2.0" });

    const res = await app.inject({ method: "GET", url: "/api/settings/agents" });
    expect(res.json().agents[0].updateAvailable).toBe(false);
  });

  it("handles installed provider with null version (unparseable --version output)", async () => {
    mocks.getAllProviderInfo.mockReturnValue([
      { id: "claude", label: "Claude Code", npmPackage: "@anthropic-ai/claude-code", installed: true, version: null },
    ]);
    mockFetchNpm({ "@anthropic-ai/claude-code": "1.0.35" });

    const res = await app.inject({ method: "GET", url: "/api/settings/agents" });
    const agent = res.json().agents[0];

    expect(agent.installed).toBe(true);
    expect(agent.version).toBeNull();
    expect(agent.updateAvailable).toBe(false);
  });

  it("sets updateAvailable false when installed version is newer than npm latest", async () => {
    mocks.getAllProviderInfo.mockReturnValue([
      { id: "codex", label: "Codex", npmPackage: "@openai/codex", installed: true, version: "0.2.1" },
    ]);
    mockFetchNpm({ "@openai/codex": "0.2.0" });

    const res = await app.inject({ method: "GET", url: "/api/settings/agents" });
    const agent = res.json().agents[0];

    expect(agent.latestVersion).toBe("0.2.0");
    expect(agent.updateAvailable).toBe(false);
  });

  it("marks updateAvailable true when latest has more numeric segments", async () => {
    mocks.getAllProviderInfo.mockReturnValue([
      { id: "claude", label: "Claude Code", npmPackage: "@anthropic-ai/claude-code", installed: true, version: "1.2" },
    ]);
    mockFetchNpm({ "@anthropic-ai/claude-code": "1.2.1" });

    const res = await app.inject({ method: "GET", url: "/api/settings/agents" });
    const agent = res.json().agents[0];

    expect(agent.latestVersion).toBe("1.2.1");
    expect(agent.updateAvailable).toBe(true);
  });

  it("keeps updateAvailable false when latest version is semver-ambiguous", async () => {
    mocks.getAllProviderInfo.mockReturnValue([
      { id: "claude", label: "Claude Code", npmPackage: "@anthropic-ai/claude-code", installed: true, version: "1.2.0" },
    ]);
    mockFetchNpm({ "@anthropic-ai/claude-code": "1.2.0-beta.1" });

    const res = await app.inject({ method: "GET", url: "/api/settings/agents" });
    const agent = res.json().agents[0];

    expect(agent.latestVersion).toBe("1.2.0-beta.1");
    expect(agent.updateAvailable).toBe(false);
  });

  it("keeps provider order stable even when fetch resolves out of order", async () => {
    mocks.getAllProviderInfo.mockReturnValue([
      { id: "claude", label: "Claude Code", npmPackage: "@anthropic-ai/claude-code", installed: true, version: "1.0.0" },
      { id: "codex", label: "Codex", npmPackage: "@openai/codex", installed: true, version: "0.1.0" },
    ]);

    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("@anthropic-ai/claude-code") || url.includes("@anthropic-ai%2Fclaude-code")) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return new Response(JSON.stringify({ version: "1.0.1" }), { status: 200 });
      }
      if (url.includes("@openai/codex") || url.includes("@openai%2Fcodex")) {
        return new Response(JSON.stringify({ version: "0.2.0" }), { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const res = await app.inject({ method: "GET", url: "/api/settings/agents" });
    const body = res.json();

    expect(body.agents.map((agent: { id: string }) => agent.id)).toEqual(["claude", "codex"]);
    expect(body.agents[0].latestVersion).toBe("1.0.1");
    expect(body.agents[1].latestVersion).toBe("0.2.0");
  });

  it("returns latestVersion null when npm response JSON is invalid", async () => {
    mocks.getAllProviderInfo.mockReturnValue([
      { id: "claude", label: "Claude Code", npmPackage: "@anthropic-ai/claude-code", installed: true, version: "1.0.0" },
    ]);
    globalThis.fetch = vi.fn(async () => {
      const response = new Response("not-json", { status: 200 });
      vi.spyOn(response, "json").mockRejectedValueOnce(new Error("invalid json"));
      return response;
    }) as typeof fetch;

    const res = await app.inject({ method: "GET", url: "/api/settings/agents" });
    const agent = res.json().agents[0];

    expect(agent.latestVersion).toBeNull();
    expect(agent.updateAvailable).toBe(false);
  });

  it("queries npm registry using scoped package path", async () => {
    mocks.getAllProviderInfo.mockReturnValue([
      { id: "claude", label: "Claude Code", npmPackage: "@anthropic-ai/claude-code", installed: true, version: "1.0.0" },
    ]);
    globalThis.fetch = vi.fn(async () => (
      new Response(JSON.stringify({ version: "1.0.0" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )) as typeof fetch;

    await app.inject({ method: "GET", url: "/api/settings/agents" });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://registry.npmjs.org/@anthropic-ai/claude-code/latest",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
