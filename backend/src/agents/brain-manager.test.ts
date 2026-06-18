import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createFixtureRepo, createTempDir } from "../utils/test-helpers.js";
import { connectBrain } from "../brain/brain-repo.js";
import {
  activateBrainSession,
  createNewBrainSession,
  getOrCreateBrainSession,
  hardDeleteBrainSession,
  listBrainSessions,
  _clearBrainSessions,
} from "./brain-manager.js";
import { MAX_SESSIONS_PER_WORKSPACE } from "./session-limits.js";

const CMD = { command: "bash" };

let tempDir: string;
let dataDir: string;

beforeEach(async () => {
  tempDir = await createTempDir("hive-brain-manager-test-");
  dataDir = join(tempDir, "data");
  await mkdir(dataDir, { recursive: true });
});

afterEach(async () => {
  _clearBrainSessions();
  await new Promise((r) => setTimeout(r, 50));
  await rm(tempDir, { recursive: true, force: true });
});

async function connectFixtureBrain(): Promise<void> {
  const fixtureDir = join(tempDir, "fixtures");
  await mkdir(fixtureDir, { recursive: true });
  const origin = await createFixtureRepo(fixtureDir);
  await connectBrain(origin, dataDir);
}

describe("brain session manager", () => {
  it("rejects session operations when the Brain is not connected", async () => {
    await expect(getOrCreateBrainSession(dataDir, CMD)).rejects.toMatchObject({ statusCode: 409 });
    await expect(listBrainSessions(dataDir)).rejects.toMatchObject({ statusCode: 409 });
    await expect(createNewBrainSession(dataDir, CMD)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("creates and reuses the active session", async () => {
    await connectFixtureBrain();
    const first = await getOrCreateBrainSession(dataDir, CMD);
    expect(first.created).toBe(true);
    const second = await getOrCreateBrainSession(dataDir, CMD);
    expect(second.created).toBe(false);
    expect(second.session.sessionId).toBe(first.session.sessionId);
  });

  it("tags sessions with the brain workspace id", async () => {
    await connectFixtureBrain();
    const { session } = await getOrCreateBrainSession(dataDir, CMD);
    expect(session.metadata.workspaceId).toBe("brain");
  });

  it("lists, switches, and deletes sessions", async () => {
    await connectFixtureBrain();
    const a = await getOrCreateBrainSession(dataDir, CMD);
    const b = await createNewBrainSession(dataDir, CMD);

    const list = await listBrainSessions(dataDir);
    expect(list).toHaveLength(2);

    const activated = await activateBrainSession(a.session.sessionId, dataDir, CMD);
    expect(activated.sessionId).toBe(a.session.sessionId);

    await hardDeleteBrainSession(b.sessionId, dataDir);
    const after = await listBrainSessions(dataDir);
    expect(after).toHaveLength(1);
    expect(after[0]?.sessionId).toBe(a.session.sessionId);
  });

  it("enforces the maximum session count", async () => {
    await connectFixtureBrain();
    for (let i = 0; i < MAX_SESSIONS_PER_WORKSPACE; i++) {
      await createNewBrainSession(dataDir, CMD);
    }
    await expect(createNewBrainSession(dataDir, CMD)).rejects.toThrow(/Maximum/);
  });
});
