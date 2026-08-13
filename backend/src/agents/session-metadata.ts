import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SessionMetadata } from "../types.js";
import { withKeyedLock } from "../utils/async-lock.js";
import { isCountedAssistantMessage, parseJsonlMessages } from "./session-utils.js";

type LegacySessionMetadata = Omit<
  SessionMetadata,
  "assistantMessageCount" | "readAssistantMessageCount"
> & {
  assistantMessageCount?: number;
  readAssistantMessageCount?: number;
  messageCount?: number;
};

const metadataLocks = new Map<string, Promise<void>>();

function migrateSessionMetadata(value: LegacySessionMetadata): {
  metadata: SessionMetadata;
  migrated: boolean;
} {
  const metadata = { ...value };
  delete metadata.messageCount;

  let migrated = false;
  if (typeof metadata.assistantMessageCount !== "number") {
    metadata.assistantMessageCount = 0;
    migrated = true;
  }
  if (typeof metadata.readAssistantMessageCount !== "number") {
    metadata.readAssistantMessageCount = metadata.assistantMessageCount;
    migrated = true;
  }
  return { metadata: metadata as SessionMetadata, migrated };
}

/** Legacy `messageCount` tracked user messages, not assistant messages, so it
 *  cannot seed the new counters directly (it can overshoot or undershoot the
 *  true eligible-assistant-message count in either direction). Derive the
 *  real count from the transcript instead. A missing/unreadable
 *  `messages.jsonl` yields 0 — correct for a session with no transcript. */
async function migrateLegacyMessageCount(
  path: string,
  value: LegacySessionMetadata,
): Promise<SessionMetadata> {
  const metadata = { ...value };
  delete metadata.messageCount;

  const raw = await readFile(join(dirname(path), "messages.jsonl"), "utf-8").catch(() => "");
  const eligible = parseJsonlMessages(raw).filter(isCountedAssistantMessage).length;
  metadata.assistantMessageCount = eligible;
  metadata.readAssistantMessageCount = eligible;

  return metadata as SessionMetadata;
}

async function writeMetadataUnlocked(path: string, metadata: SessionMetadata): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, JSON.stringify(metadata, null, 2), "utf-8");
    await rename(tempPath, path);
  } catch (err) {
    await unlink(tempPath).catch(() => {});
    throw err;
  }
}

async function readMetadataUnlocked(path: string): Promise<SessionMetadata> {
  const raw = await readFile(path, "utf-8");
  const parsed = JSON.parse(raw) as LegacySessionMetadata;

  if (typeof parsed.messageCount === "number") {
    const metadata = await migrateLegacyMessageCount(path, parsed);
    await writeMetadataUnlocked(path, metadata);
    return metadata;
  }

  const { metadata, migrated } = migrateSessionMetadata(parsed);
  if (migrated) {
    await writeMetadataUnlocked(path, metadata);
  }
  return metadata;
}

export async function readSessionMetadata(path: string): Promise<SessionMetadata> {
  return withKeyedLock(metadataLocks, path, () => readMetadataUnlocked(path));
}

export async function writeSessionMetadata(
  path: string,
  metadata: SessionMetadata,
): Promise<void> {
  await withKeyedLock(metadataLocks, path, () => writeMetadataUnlocked(path, metadata));
}

export async function updateSessionMetadata(
  path: string,
  update: (metadata: SessionMetadata) => SessionMetadata,
): Promise<SessionMetadata> {
  return withKeyedLock(metadataLocks, path, async () => {
    const current = await readMetadataUnlocked(path);
    const updated = update(current);
    await writeMetadataUnlocked(path, updated);
    return updated;
  });
}
