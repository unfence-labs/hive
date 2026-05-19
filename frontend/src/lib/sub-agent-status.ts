import type { ToolCall } from "@/types";
import { parseSubAgentInfo } from "@/lib/sub-agent";

export type SubAgentExecutionState = "pending" | "running" | "completed" | "failed";

type JsonObject = Record<string, unknown>;

const RUNNING_AGENT_STATUSES = new Set(["pendinginit", "running", "interrupted"]);
const FAILED_AGENT_STATUSES = new Set(["errored", "notfound", "failed"]);

export interface SubAgentExecutionOptions {
  showExecutingState?: boolean;
  children?: ToolCall[];
  childrenMap?: Map<string, ToolCall[]>;
}

export function getSubAgentExecutionState(
  tool: ToolCall,
  options: SubAgentExecutionOptions = {},
): SubAgentExecutionState {
  if (tool.name !== "Task" && tool.name !== "Agent") {
    return tool.output === undefined ? "pending" : "completed";
  }

  const info = parseSubAgentInfo(tool);
  const inputPayload = parseJsonObject(tool.input);
  const outputPayload = parseToolOutputPayload(tool.output);
  const toolStatus = normalizeStatus(stringValue(outputPayload?.status ?? inputPayload?.status));
  const agentStatuses = [
    ...agentStatusesFromPayload(inputPayload),
    ...agentStatusesFromPayload(outputPayload),
  ];

  if (toolStatus === "failed" || agentStatuses.some((status) => FAILED_AGENT_STATUSES.has(status))) {
    return "failed";
  }

  if (!options.showExecutingState) {
    return tool.output === undefined ? "pending" : "completed";
  }

  if (tool.output === undefined) {
    return "running";
  }

  if (
    info?.tool === "spawnAgent" &&
    agentStatuses.some((status) => RUNNING_AGENT_STATUSES.has(status))
  ) {
    return "running";
  }

  if (hasRunningDescendant(options.children ?? [], options.childrenMap)) {
    return "running";
  }

  return "completed";
}

export function isSubAgentRunning(tool: ToolCall, options: SubAgentExecutionOptions = {}): boolean {
  return getSubAgentExecutionState(tool, options) === "running";
}

function hasRunningDescendant(children: ToolCall[], childrenMap: Map<string, ToolCall[]> | undefined): boolean {
  for (const child of children) {
    const nestedChildren = childrenMap?.get(child.id) ?? [];
    if (child.name === "Task" || child.name === "Agent") {
      if (getSubAgentExecutionState(child, {
        showExecutingState: true,
        children: nestedChildren,
        childrenMap,
      }) === "running") {
        return true;
      }
      continue;
    }
    if (child.output === undefined || hasRunningDescendant(nestedChildren, childrenMap)) {
      return true;
    }
  }
  return false;
}

function agentStatusesFromPayload(payload: JsonObject | null): string[] {
  const states = asObject(payload?.agentsStates) ?? asObject(payload?.agents_states);
  if (!states) return [];
  return Object.values(states)
    .map((entry) => normalizeStatus(stringValue(asObject(entry)?.status)))
    .filter((status): status is string => status !== undefined);
}

function parseToolOutputPayload(output: string | undefined): JsonObject | null {
  if (!output) return null;

  const parsed = parseJson(output);
  const direct = asObject(parsed);
  if (direct) return direct;

  // Codex collab results arrive as text content blocks whose text is a JSON payload.
  if (!Array.isArray(parsed)) return null;
  for (const block of parsed) {
    const text = stringValue(asObject(block)?.text);
    const payload = text ? parseJsonObject(text) : null;
    if (payload) return payload;
  }
  return null;
}

function parseJsonObject(value: string | undefined): JsonObject | null {
  return asObject(parseJson(value));
}

function parseJson(value: string | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeStatus(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.replace(/_/g, "").toLowerCase();
}
