import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  StartToolOperationResponse,
  ToolOperation,
  ToolsResponse,
} from "@hive/shared/setup-types";
import type { CommandResult } from "../services/setup/command.js";
import {
  createToolOperationStore,
  type ToolOperationStore,
} from "../services/setup/operations.js";
import type { ToolsServiceDeps } from "../services/setup/tools-service.js";
import { setupRoutes } from "./setup.js";

let app: FastifyInstance;
let dataDir: string;
let gate: { promise: Promise<void>; resolve: () => void };
let installCalls: string[];

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

async function build(probes: Record<string, CommandResult> = {}): Promise<void> {
  app = Fastify();
  store = await createToolOperationStore({ dataDir });
  await app.register((instance: FastifyInstance) =>
    setupRoutes(instance, { dataDir, deps: makeDeps(probes), store }),
  );
  await app.ready();
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "hive-setup-api-"));
  installCalls = [];
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
  it("addresses a running operation individually", async () => {
    await build();
    const started = (await app.inject({ method: "POST", url: "/api/setup/tools/claude/install" }))
      .json<StartToolOperationResponse>();

    const res = await app.inject({
      method: "GET",
      url: `/api/setup/operations/${started.operation.id}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<ToolOperation>()).toMatchObject({
      id: started.operation.id,
      status: "running",
    });
  });

  it("surfaces the running operation to a client that has no operation id", async () => {
    await build();
    const started = (await app.inject({ method: "POST", url: "/api/setup/tools/claude/install" }))
      .json<StartToolOperationResponse>();

    // A reloaded client knows nothing but the tool listing, and still finds it.
    const body = (await app.inject({ method: "GET", url: "/api/setup/tools" })).json<ToolsResponse>();
    expect(body.operations).toHaveLength(1);
    expect(body.operations[0]).toMatchObject({ id: started.operation.id, status: "running" });
  });

  it("404s an operation it does not know", async () => {
    await build();
    const res = await app.inject({ method: "GET", url: "/api/setup/operations/op-aaaaaaaaaa" });
    expect(res.statusCode).toBe(404);
  });

  it("rejects a malformed operation id before it reaches the store", async () => {
    await build();
    const res = await app.inject({ method: "GET", url: "/api/setup/operations/..%2Fetc" });
    expect(res.statusCode).toBe(400);
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
      await app.inject({ method: "GET", url: `/api/setup/operations/${started.operation.id}` })
    ).json<ToolOperation>();

    expect(operation.status).toBe("failed");
    expect(operation.failure?.reason).toBe("network");
    expect(operation.failure?.outputExcerpt).toContain("ENOTFOUND");
    expect(operation.failure?.outputExcerpt?.length).toBeLessThanOrEqual(2_000);
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
      await app.inject({ method: "GET", url: `/api/setup/operations/${started.operation.id}` })
    ).json<ToolOperation>();

    expect(operation.status).toBe("failed");
    expect(operation.failure?.reason).toBe("interrupted");
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
