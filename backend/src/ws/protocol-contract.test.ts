import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

const BACKEND_TYPES_PATH = `${repoRoot}/backend/src/types.ts`;
const FRONTEND_TYPES_PATH = `${repoRoot}/frontend/src/types.ts`;
const SWIFT_WS_TYPES_PATH = `${repoRoot}/ios/HiveMobile/Models/WebSocketTypes.swift`;

const swiftDecoderExceptions = new Set([
  // Web/Tauri-only event for the live agent-browser panel; iOS intentionally treats it as unknown.
  "browser_status",
  // Web/Tauri-only event for the workspace preview proxy; iOS intentionally treats it as unknown.
  "preview_status",
]);

function readRepoFile(path: string): string {
  return readFileSync(path, "utf-8");
}

function extractWsOutgoingTypeNames(source: string): string[] {
  const marker = "export type WsOutgoing =";
  const start = source.indexOf(marker);
  expect(start, `${marker} should exist`).toBeGreaterThanOrEqual(0);

  const end = source.indexOf("\n\n", start);
  expect(end, "WsOutgoing union should end before the next blank line").toBeGreaterThan(start);

  const unionSource = source.slice(start, end);
  return [...unionSource.matchAll(/\btype:\s*"([^"]+)"/g)].map((match) => match[1] ?? "");
}

function extractSwiftWsOutgoingDecoderTypeNames(source: string): string[] {
  const enumMarker = "enum WsOutgoing: Decodable {";
  const enumStart = source.indexOf(enumMarker);
  expect(enumStart, `${enumMarker} should exist`).toBeGreaterThanOrEqual(0);

  const initMarker = "init(from decoder: Decoder) throws {";
  const initStart = source.indexOf(initMarker, enumStart);
  expect(initStart, "WsOutgoing decoder init should exist").toBeGreaterThan(enumStart);

  const helperMarker = "// MARK: - AnyCodableValue";
  const helperStart = source.indexOf(helperMarker, initStart);
  expect(helperStart, "WsOutgoing decoder should end before helper types").toBeGreaterThan(initStart);

  const decoderSource = source.slice(initStart, helperStart);
  return [...decoderSource.matchAll(/^\s*case\s+"([^"]+)":/gm)].map((match) => match[1] ?? "");
}

describe("WebSocket protocol contract", () => {
  it("keeps backend and frontend outgoing event names in sync", () => {
    const backendTypes = extractWsOutgoingTypeNames(readRepoFile(BACKEND_TYPES_PATH));
    const frontendTypes = extractWsOutgoingTypeNames(readRepoFile(FRONTEND_TYPES_PATH));

    expect(frontendTypes).toEqual(backendTypes);
  });

  it("keeps backend outgoing event names represented in the Swift decoder", () => {
    const backendTypes = extractWsOutgoingTypeNames(readRepoFile(BACKEND_TYPES_PATH));
    const swiftDecoderTypes = new Set(extractSwiftWsOutgoingDecoderTypeNames(readRepoFile(SWIFT_WS_TYPES_PATH)));

    const missingSwiftCases = backendTypes.filter(
      (type) => !swiftDecoderTypes.has(type) && !swiftDecoderExceptions.has(type),
    );

    expect(missingSwiftCases).toEqual([]);
  });
});
