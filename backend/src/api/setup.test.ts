import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SetupStatusResponse,
  StartToolOperationResponse,
  ToolAuthSession,
  ToolsResponse,
} from "@hive/shared/setup-types";
import type { CommandResult } from "../services/setup/command.js";
import type { ToolDetection } from "../services/setup/detect.js";
import {
  ToolAuthError,
  type AuthFlow,
  type AuthorizationPrompt,
  type ToolAuthOutcome,
} from "../services/setup/auth/flow.js";
import {
  createToolAuthStore,
  type ToolAuthStore,
} from "../services/setup/auth/sessions.js";
import {
  createToolOperationStore,
  type ToolOperationStore,
} from "../services/setup/operations.js";
import type { ToolsServiceDeps } from "../services/setup/tools-service.js";
import { setupRoutes } from "./setup.js";

const VALID_CLAUDE_TOKEN = "sk-ant-oat01-AbC123_dEf456-GhI789jklMNO";

let app: FastifyInstance;
let dataDir: string;
let gate: { promise: Promise<void>; resolve: () => void };
let installCalls: string[];
let probeCalls: string[];

function ok(stdout = ""): CommandResult {
  return { stdout, stderr: "", exitCode: 0, timedOut: false };
}

function missing(): CommandResult {
  return { stdout: "", stderr: "not found", exitCode: 127, timedOut: false };
}

/**
 * A service whose install command blocks on `gate`, so an operation can be
 * observed while it is genuinely still running.
 */
function makeDeps(probes: Record<string, CommandResult>): ToolsServiceDeps {
  const run = async (command: string, args: string[]): Promise<CommandResult> => {
    if (command === "npm") {
      installCalls.push([command, ...args].join(" "));
      await gate.promise;
      return ok("added 1 package");
    }
    probeCalls.push([command, ...args].join(" "));
    return probes[[command, ...args].join(" ")] ?? missing();
  };
  return {
    prefix: "/home/hive/.local",
    run,
    detect: { env: {}, run },
    fetchLatestVersion: async () => null,
    onToolsChanged: async () => {},
  };
}

let store: ToolOperationStore;
let authStore: ToolAuthStore;

async function build(
  probes: Record<string, CommandResult> = {},
  auth?: ToolAuthStore,
): Promise<void> {
  app = Fastify();
  store = await createToolOperationStore({ dataDir });
  authStore = auth ?? createToolAuthStore({ flows: {}, detect: async () => detection() });
  await app.register((instance: FastifyInstance) =>
    setupRoutes(instance, { dataDir, deps: makeDeps(probes), store, authStore }),
  );
  await app.ready();
}

function detection(overrides: Partial<ToolDetection> = {}): ToolDetection {
  return { installed: true, version: "1.0.0", authenticated: false, ...overrides };
}

/**
 * A sign-in flow under the test's control: it surfaces whatever prompt it was
 * given, then sits there until the test says how it ends.
 */
function scriptedFlow(prompt?: AuthorizationPrompt): {
  flow: AuthFlow;
  finish: (outcome: ToolAuthOutcome) => void;
  fail: (error: unknown) => void;
  codes: string[];
} {
  const codes: string[] = [];
  let settle!: (outcome: ToolAuthOutcome) => void;
  let reject!: (error: unknown) => void;
  const done = new Promise<ToolAuthOutcome>((resolve, rejectFn) => {
    settle = resolve;
    reject = rejectFn;
  });

  return {
    codes,
    finish: (outcome) => settle(outcome),
    fail: (error) => reject(error),
    flow: (ctx) => {
      if (prompt) ctx.prompt(prompt);
      return {
        done,
        submitCode: (code) => codes.push(code),
        cancel: () => settle("cancelled"),
      };
    },
  };
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "hive-setup-api-"));
  installCalls = [];
  probeCalls = [];
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  gate = { promise, resolve };
});

afterEach(async () => {
  // Let anything still blocked on the gate finish writing before the data
  // directory disappears underneath it.
  gate.resolve();
  await store?.whenIdle();
  await authStore?.whenIdle();
  await app?.close();
  await rm(dataDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("GET /api/setup/tools", () => {
  it("reports installed state, version and sign-in for every tool", async () => {
    await build({
      "claude --version": ok("1.0.0"),
      "claude auth status": ok('{"loggedIn":true}'),
      "gh --version": ok("gh version 2.62.0"),
      "gh auth status": ok("Logged in"),
    });

    const res = await app.inject({ method: "GET", url: "/api/setup/tools" });
    expect(res.statusCode).toBe(200);

    const body = res.json<ToolsResponse>();
    expect(body.tools.map((t) => t.id)).toEqual(["claude", "codex", "gh"]);
    expect(body.tools[0]).toMatchObject({ installed: true, version: "1.0.0", authenticated: true });
    expect(body.tools[1]).toMatchObject({ installed: false, authenticated: false });
    expect(body.tools[2]).toMatchObject({ installed: true, authenticated: true, managed: false });
    expect(body.operations).toEqual([]);
    expect(body.authSessions).toEqual([]);
  });
});

describe("POST /api/setup/tools/:tool/:kind", () => {
  it("starts an install and reports it as running", async () => {
    await build();

    const res = await app.inject({ method: "POST", url: "/api/setup/tools/claude/install" });
    expect(res.statusCode).toBe(200);

    const body = res.json<StartToolOperationResponse>();
    expect(body.joined).toBe(false);
    expect(body.operation).toMatchObject({
      tool: "claude",
      kind: "install",
      status: "running",
    });
  });

  it("joins a running operation rather than starting a second one", async () => {
    await build();

    const first = (await app.inject({ method: "POST", url: "/api/setup/tools/claude/install" }))
      .json<StartToolOperationResponse>();
    const second = (await app.inject({ method: "POST", url: "/api/setup/tools/claude/install" }))
      .json<StartToolOperationResponse>();
    const asUpdate = (await app.inject({ method: "POST", url: "/api/setup/tools/claude/update" }))
      .json<StartToolOperationResponse>();

    expect(second.joined).toBe(true);
    expect(second.operation.id).toBe(first.operation.id);
    expect(asUpdate.joined).toBe(true);
    expect(asUpdate.operation.id).toBe(first.operation.id);
    expect(installCalls).toHaveLength(1);
  });

  it("refuses to install a tool Hive does not manage", async () => {
    await build();

    const res = await app.inject({ method: "POST", url: "/api/setup/tools/gh/install" });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toContain("GitHub CLI");
    expect(installCalls).toEqual([]);
  });

  it("rejects an unknown tool", async () => {
    await build();
    const res = await app.inject({ method: "POST", url: "/api/setup/tools/rm-rf/install" });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an unknown operation kind", async () => {
    await build();
    const res = await app.inject({ method: "POST", url: "/api/setup/tools/claude/uninstall" });
    expect(res.statusCode).toBe(400);
  });
});

describe("operation visibility", () => {
  it("surfaces the running operation to a client that has no operation id", async () => {
    await build();
    const started = (await app.inject({ method: "POST", url: "/api/setup/tools/claude/install" }))
      .json<StartToolOperationResponse>();

    // A reloaded client knows nothing but the tool listing, and still finds it.
    const body = (await app.inject({ method: "GET", url: "/api/setup/tools" })).json<ToolsResponse>();
    expect(body.operations).toHaveLength(1);
    expect(body.operations[0]).toMatchObject({ id: started.operation.id, status: "running" });
  });

  it("reports a failed install with a typed reason and a bounded excerpt", async () => {
    app = Fastify();
    const deps = makeDeps({});
    deps.run = async (command) => {
      if (command === "npm") {
        return {
          stdout: "",
          stderr: "npm error code ENOTFOUND\nnpm error syscall getaddrinfo",
          exitCode: 1,
          timedOut: false,
        };
      }
      return missing();
    };
    deps.detect = { env: {}, run: deps.run };
    store = await createToolOperationStore({ dataDir });
    await app.register((instance: FastifyInstance) =>
      setupRoutes(instance, { dataDir, deps, store }),
    );
    await app.ready();

    const started = (await app.inject({ method: "POST", url: "/api/setup/tools/codex/install" }))
      .json<StartToolOperationResponse>();
    await store.whenIdle();

    const operation = (
      await app.inject({ method: "GET", url: "/api/setup/status" })
    ).json<SetupStatusResponse>().operations.find((o) => o.id === started.operation.id);

    expect(operation?.status).toBe("failed");
    expect(operation?.failure?.reason).toBe("network");
    expect(operation?.failure?.outputExcerpt).toContain("ENOTFOUND");
    expect(operation?.failure?.outputExcerpt?.length).toBeLessThanOrEqual(2_000);
  });
});

describe("GET /api/setup/status", () => {
  it("reports operations and sign-in sessions without re-running detection", async () => {
    const claude = scriptedFlow({ verificationUri: "https://claude.com/x", needsCode: true });
    await build(
      {},
      createToolAuthStore({ flows: { claude: { flow: claude.flow } }, detect: async () => detection() }),
    );
    const started = (await app.inject({ method: "POST", url: "/api/setup/tools/claude/install" }))
      .json<StartToolOperationResponse>();
    await app.inject({ method: "POST", url: "/api/setup/auth/claude/start" });
    const probesBefore = probeCalls.length;

    const res = await app.inject({ method: "GET", url: "/api/setup/status" });

    expect(res.statusCode).toBe(200);
    const body = res.json<SetupStatusResponse>();
    expect(body.operations).toHaveLength(1);
    expect(body.operations[0]).toMatchObject({ id: started.operation.id, status: "running" });
    expect(body.authSessions).toHaveLength(1);
    expect(body.authSessions[0]).toMatchObject({ tool: "claude", state: "awaiting_code" });
    // The whole point of the route: a progress poll spawns no probe.
    expect(probeCalls).toHaveLength(probesBefore);

    claude.finish("cancelled");
  });
});

describe("restart recovery", () => {
  /**
   * Stand a second server up over the same data directory, standing in for
   * the process that was killed mid-install. The abandoned run is left
   * blocked on the gate on purpose: that is exactly the record with no
   * process behind it that the boot reaper exists for.
   */
  async function restart(): Promise<void> {
    const abandoned = store;
    await app.close();
    app = Fastify();
    store = await createToolOperationStore({ dataDir });
    await app.register((instance: FastifyInstance) =>
      setupRoutes(instance, { dataDir, deps: makeDeps({}), store }),
    );
    await app.ready();
    gate.resolve();
    await abandoned.whenIdle();
  }

  it("does not leave an operation wedged in running after the server restarts", async () => {
    await build();
    const started = (await app.inject({ method: "POST", url: "/api/setup/tools/claude/install" }))
      .json<StartToolOperationResponse>();
    await restart();

    const operation = (
      await app.inject({ method: "GET", url: "/api/setup/status" })
    ).json<SetupStatusResponse>().operations.find((o) => o.id === started.operation.id);

    expect(operation?.status).toBe("failed");
    expect(operation?.failure?.reason).toBe("interrupted");
  });

  it("lets the operator start over after a reaped operation", async () => {
    await build();
    await app.inject({ method: "POST", url: "/api/setup/tools/claude/install" });
    await restart();

    const retry = (await app.inject({ method: "POST", url: "/api/setup/tools/claude/install" }))
      .json<StartToolOperationResponse>();
    expect(retry.joined).toBe(false);
    expect(retry.operation.status).toBe("running");
  });
});

// ── Sign-in ──────────────────────────────────────────────────────────

describe("POST /api/setup/auth/:tool/start", () => {
  it("starts a sign-in and reports what the operator must do", async () => {
    const claude = scriptedFlow({
      verificationUri: "https://claude.com/cai/oauth/authorize?state=abc",
      needsCode: true,
    });
    await build(
      {},
      createToolAuthStore({ flows: { claude: { flow: claude.flow } }, detect: async () => detection() }),
    );

    const res = await app.inject({ method: "POST", url: "/api/setup/auth/claude/start" });

    expect(res.statusCode).toBe(200);
    expect(res.json<ToolAuthSession>()).toMatchObject({
      tool: "claude",
      state: "awaiting_code",
      needsCode: true,
      verificationUri: "https://claude.com/cai/oauth/authorize?state=abc",
    });

    claude.finish("cancelled");
  });

  it("carries the live session on the tools listing a reloaded client polls", async () => {
    const codex = scriptedFlow({
      verificationUri: "https://auth.openai.com/codex/device",
      userCode: "U927-TJEHB",
    });
    await build(
      {},
      createToolAuthStore({ flows: { codex: { flow: codex.flow } }, detect: async () => detection() }),
    );
    await app.inject({ method: "POST", url: "/api/setup/auth/codex/start" });

    const body = (await app.inject({ method: "GET", url: "/api/setup/tools" })).json<ToolsResponse>();

    expect(body.authSessions).toHaveLength(1);
    expect(body.authSessions[0]).toMatchObject({
      tool: "codex",
      state: "awaiting_authorization",
      userCode: "U927-TJEHB",
      needsCode: false,
    });

    codex.finish("cancelled");
  });

  it("refuses to sign out a working Codex without an explicit yes", async () => {
    const codex = scriptedFlow();
    await build(
      {},
      createToolAuthStore({
        flows: { codex: { flow: codex.flow, confirmWhenConnected: "This signs you out first." } },
        detect: async () => detection({ authenticated: true }),
      }),
    );

    const res = await app.inject({ method: "POST", url: "/api/setup/auth/codex/start" });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      code: "confirm_required",
      message: "This signs you out first.",
    });
    // Nothing started, so nothing was destroyed.
    const body = (await app.inject({ method: "GET", url: "/api/setup/tools" })).json<ToolsResponse>();
    expect(body.authSessions).toEqual([]);
  });

  it("starts once the operator has said yes", async () => {
    const codex = scriptedFlow({ verificationUri: "https://auth.openai.com/codex/device" });
    await build(
      {},
      createToolAuthStore({
        flows: { codex: { flow: codex.flow, confirmWhenConnected: "This signs you out first." } },
        detect: async () => detection({ authenticated: true }),
      }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/setup/auth/codex/start",
      payload: { force: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<ToolAuthSession>().state).toBe("awaiting_authorization");

    codex.finish("cancelled");
  });

  it("joins the sign-in already running rather than starting a second", async () => {
    const claude = scriptedFlow({ verificationUri: "https://claude.com/x", needsCode: true });
    let starts = 0;
    await build(
      {},
      createToolAuthStore({
        flows: {
          claude: {
            flow: (ctx) => {
              starts += 1;
              return claude.flow(ctx);
            },
          },
        },
        detect: async () => detection(),
      }),
    );

    await app.inject({ method: "POST", url: "/api/setup/auth/claude/start" });
    await app.inject({ method: "POST", url: "/api/setup/auth/claude/start" });

    expect(starts).toBe(1);

    claude.finish("cancelled");
  });

  it("drives the GitHub sign-in through the same session machinery", async () => {
    const github = scriptedFlow({
      verificationUri: "https://github.com/login/device",
      userCode: "ABCD-1234",
    });
    await build(
      {},
      createToolAuthStore({ flows: { gh: { flow: github.flow } }, detect: async () => detection() }),
    );

    const res = await app.inject({ method: "POST", url: "/api/setup/auth/gh/start" });

    expect(res.statusCode).toBe(200);
    expect(res.json<ToolAuthSession>()).toMatchObject({
      tool: "gh",
      state: "awaiting_authorization",
      userCode: "ABCD-1234",
      needsCode: false,
    });

    github.finish("connected");
    await authStore.whenIdle();

    // The cheap status poll sees it end, so no client needs a GitHub-shaped path.
    const body = (await app.inject({ method: "GET", url: "/api/setup/status" }))
      .json<SetupStatusResponse>();
    expect(body.authSessions[0]).toMatchObject({ tool: "gh", state: "connected" });
  });

  it("rejects a sign-in for a tool the store has no flow for", async () => {
    await build();
    const res = await app.inject({ method: "POST", url: "/api/setup/auth/gh/start" });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /api/setup/auth/:tool/code", () => {
  it("hands a pasted code to the flow waiting for one", async () => {
    const claude = scriptedFlow({ verificationUri: "https://claude.com/x", needsCode: true });
    await build(
      {},
      createToolAuthStore({ flows: { claude: { flow: claude.flow } }, detect: async () => detection() }),
    );
    await app.inject({ method: "POST", url: "/api/setup/auth/claude/start" });

    const res = await app.inject({
      method: "POST",
      url: "/api/setup/auth/claude/code",
      payload: { code: "  abc123  " },
    });

    expect(res.statusCode).toBe(200);
    expect(claude.codes).toEqual(["abc123"]);

    claude.finish("connected");
  });

  it("rejects a code when nothing is waiting for one", async () => {
    await build(
      {},
      createToolAuthStore({ flows: { claude: { flow: scriptedFlow().flow } }, detect: async () => detection() }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/setup/auth/claude/code",
      payload: { code: "abc123" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/waiting for a code/i);
  });
});

describe("POST /api/setup/auth/:tool/cancel", () => {
  it("cancels a running sign-in", async () => {
    const claude = scriptedFlow({ verificationUri: "https://claude.com/x", needsCode: true });
    await build(
      {},
      createToolAuthStore({ flows: { claude: { flow: claude.flow } }, detect: async () => detection() }),
    );
    await app.inject({ method: "POST", url: "/api/setup/auth/claude/start" });

    const res = await app.inject({ method: "POST", url: "/api/setup/auth/claude/cancel" });

    expect(res.statusCode).toBe(200);
    expect(res.json<ToolAuthSession>()).toMatchObject({ state: "cancelled", needsCode: false });
  });

  it("reports nothing to cancel", async () => {
    await build();
    const res = await app.inject({ method: "POST", url: "/api/setup/auth/claude/cancel" });
    expect(res.statusCode).toBe(404);
  });
});

describe("a sign-in that fails", () => {
  it("reports the reason and the output, not just that it failed", async () => {
    const codex = scriptedFlow();
    await build(
      {},
      createToolAuthStore({ flows: { codex: { flow: codex.flow } }, detect: async () => detection() }),
    );
    await app.inject({ method: "POST", url: "/api/setup/auth/codex/start" });

    codex.fail(
      new ToolAuthError("unsupported_cli", "Codex 0.90.0 does not support device sign-in.", {
        outputExcerpt: "unknown flag --device-auth",
      }),
    );
    await authStore.whenIdle();

    const body = (await app.inject({ method: "GET", url: "/api/setup/tools" })).json<ToolsResponse>();
    expect(body.authSessions[0]).toMatchObject({
      state: "failed",
      failure: {
        reason: "unsupported_cli",
        message: "Codex 0.90.0 does not support device sign-in.",
        outputExcerpt: "unknown flag --device-auth",
      },
    });
  });

  it("reports an expired code as expired rather than as a failure", async () => {
    const codex = scriptedFlow({ verificationUri: "https://auth.openai.com/codex/device" });
    await build(
      {},
      createToolAuthStore({ flows: { codex: { flow: codex.flow } }, detect: async () => detection() }),
    );
    await app.inject({ method: "POST", url: "/api/setup/auth/codex/start" });

    codex.finish("expired");
    await authStore.whenIdle();

    const body = (await app.inject({ method: "GET", url: "/api/setup/tools" })).json<ToolsResponse>();
    expect(body.authSessions[0]).toMatchObject({ state: "expired" });
    expect(body.authSessions[0].failure).toBeUndefined();
  });
});

describe("POST /api/setup/auth/claude/token", () => {
  it("stores a token pasted directly", async () => {
    await build();

    const res = await app.inject({
      method: "POST",
      url: "/api/setup/auth/claude/token",
      payload: { token: `  ${VALID_CLAUDE_TOKEN}  ` },
    });

    expect(res.statusCode).toBe(200);
    const stored = JSON.parse(
      await readFile(join(dataDir, "config.json"), "utf-8"),
    ) as { claudeCodeOAuthToken: string };
    expect(stored.claudeCodeOAuthToken).toBe(VALID_CLAUDE_TOKEN);
  });

  it("rejects something that is not a token without echoing it back", async () => {
    await build();

    const res = await app.inject({
      method: "POST",
      url: "/api/setup/auth/claude/token",
      payload: { token: "sk-ant-oat01-nearly-but-not" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).not.toContain("sk-ant");
  });
});
