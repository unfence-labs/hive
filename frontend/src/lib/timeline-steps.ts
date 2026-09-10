import { commandExecutionActivityToToolCall } from "@hive/shared/agent-activity";
import type { AgentActivity, ChatMessage, ReasoningSegment, ToolCall } from "@/types";
import { isAskUserQuestion, isExitPlanMode, parseQuestions } from "@/types";
import { buildChildrenMap, parseSubAgentInfo } from "@/lib/sub-agent";
import { getSubAgentExecutionState } from "@/lib/sub-agent-status";
import { findPlanContent } from "@/lib/plan-state";
import { getBashMetadata, getFilename, getToolDisplay, getToolStats, parseToolInput } from "@/lib/tool-display";

export type StepStatus = "pending" | "running" | "completed" | "failed";
export type StepKind =
  | "tool"
  | "agent"
  | "reasoning"
  | "question"
  | "plan"
  | "diagnostic"
  | "image"
  | "compaction"
  | "subagent_activity"
  | "prompt"
  | "result";
export type StepIcon =
  | "file"
  | "pencil"
  | "terminal"
  | "search"
  | "globe"
  | "bot"
  | "listChecks"
  | "wrench"
  | "brain"
  | "question"
  | "plan"
  | "image"
  | "fold"
  | "alert"
  | "prompt"
  | "result";
export type StepStats = { type: "diff"; added: number; removed: number } | { type: "plain"; label: string };
export type PlanStatus = "interactive" | "approved" | "revised";

export interface TimelineStep {
  id: string;
  kind: StepKind;
  icon: StepIcon;
  /** Present-tense sentence for the live line, e.g. "Reading", "Editing", "Running". */
  liveVerb: string;
  /** Past-tense pill after the subject, e.g. "read", "edited", "ran". */
  verb: string;
  /** Subject first: file name, truncated command, pattern, url, agent type + description, headline. */
  subject: string;
  /** Full-length subject for tooltips (full path, full command). */
  subjectTitle?: string;
  status: StepStatus;
  stats?: StepStats;
  /** Diagnostic steps only: trailing mark severity; info carries no mark. */
  severity?: "warning" | "error";
  /** True when the step must never be folded inside a run: questions, plans and diagnostics only. */
  standalone: boolean;
  /** Agent steps only: nested child steps built from parentToolUseId, in tool array order. */
  children?: TimelineStep[];
  /** Source payload for the detail renderer; the view-model does not build detail content. */
  source:
    | { type: "tool"; tool: ToolCall }
    | { type: "activity"; activity: AgentActivity }
    | { type: "reasoning"; segments: ReasoningSegment[] }
    | { type: "text"; text: string; markdown: boolean };
}

export type TimelineRow =
  | { type: "text"; id: string; text: string }
  | { type: "run"; id: string; steps: TimelineStep[] }
  | { type: "step"; id: string; step: TimelineStep };

export interface BuildRowsOptions {
  streaming: boolean;
}

export const RUN_COLLAPSE_THRESHOLD = 2;

const HIDDEN_TOOLS = new Set(["TaskUpdate", "TodoList"]);
/** Steps that need the user's attention or decision; everything else joins a run and its summary. */
const STANDALONE_KINDS = new Set<StepKind>(["question", "plan", "diagnostic"]);

type FileChangeActivity = Extract<AgentActivity, { kind: "file_change" }>;

interface BuildContext {
  streaming: boolean;
  childrenMap: Map<string, ToolCall[]>;
}

export function buildTimelineRows(message: ChatMessage, options: BuildRowsOptions): TimelineRow[] {
  const toolCalls = message.toolCalls ?? [];
  const activities = message.agentActivities ?? [];
  const segments = message.reasoningSegments ?? [];
  const context: BuildContext = { streaming: options.streaming, childrenMap: buildChildrenMap(toolCalls) };
  const planWriteToolId = toolCalls.some(isExitPlanMode) ? findPlanContent(toolCalls)?.writeToolId : undefined;
  const isTopLevelTool = (tool: ToolCall) =>
    !tool.parentToolUseId && !HIDDEN_TOOLS.has(tool.name) && tool.id !== planWriteToolId;

  const rows: TimelineRow[] = [];
  const pushText = (id: string, text: string) => {
    if (text) rows.push({ type: "text", id: `text:${id}`, text });
  };
  const pushStep = (step: TimelineStep) => {
    const id = `${step.source.type}:${step.id}`;
    if (step.standalone) {
      rows.push({ type: "step", id, step });
      return;
    }
    const previous = rows.at(-1);
    if (previous?.type === "run") {
      previous.steps.push(step);
    } else {
      rows.push({ type: "run", id, steps: [step] });
    }
  };
  const pushActivity = (activity: AgentActivity, streaming: boolean) => {
    for (const step of activitySteps(activity, streaming)) pushStep(step);
  };

  // Diagnostics report on the turn as a whole, so they lead every message and
  // never split a run, wherever the provider emitted them.
  const isDiagnostic = (activity: AgentActivity) => activity.kind === "diagnostic";
  for (const activity of activities.filter(isDiagnostic)) pushActivity(activity, options.streaming);

  if (!message.timeline) {
    // Codex persisted each command both as a tool call and as an activity: the tool call wins.
    const toolIds = new Set(toolCalls.map((tool) => tool.id));
    const legacyActivities = activities.filter((activity) => !toolIds.has(activity.id));
    if (segments.some((segment) => segment.headline || segment.body)) {
      pushStep(reasoningStep("reasoning", segments, false));
    }
    pushText(message.id, message.content);
    for (const tool of toolCalls) {
      if (isTopLevelTool(tool)) pushStep(toolStep(tool, context));
    }
    for (const activity of legacyActivities) {
      if (!isDiagnostic(activity)) pushActivity(activity, options.streaming);
    }
    return rows;
  }

  // A finalized turn can contain only the server's cancellation/error fallback.
  if (message.timeline.length === 0 && !options.streaming) pushText(message.id, message.content);

  const toolsById = new Map(toolCalls.map((tool) => [tool.id, tool]));
  const activitiesById = new Map(activities.map((activity) => [activity.id, activity]));
  const lastEntry = message.timeline.at(-1);
  for (const entry of message.timeline) {
    switch (entry.type) {
      case "text":
        pushText(entry.id, entry.text);
        break;
      case "tool": {
        const tool = toolsById.get(entry.id);
        if (tool && isTopLevelTool(tool)) pushStep(toolStep(tool, context));
        break;
      }
      case "activity": {
        const activity = activitiesById.get(entry.id);
        if (activity && !isDiagnostic(activity)) pushActivity(activity, options.streaming);
        break;
      }
      case "reasoning": {
        const matching = segments.filter(
          (segment) => segment.id === entry.id || segment.id.startsWith(`${entry.id}:`),
        );
        if (matching.some((segment) => segment.headline || segment.body)) {
          pushStep(reasoningStep(entry.id, matching, options.streaming && entry === lastEntry));
        }
        break;
      }
    }
  }
  return rows;
}

/** Terse run summary: an agent counts once regardless of children; the expanded list carries the detail. */
export function summarizeRun(steps: TimelineStep[]): { label: string; failed: number; icons: StepIcon[] } {
  const icons: StepIcon[] = [];
  let failed = 0;
  for (const step of steps) {
    if (!icons.includes(step.icon)) icons.push(step.icon);
    if (step.status === "failed" || hasFailedDescendant(step)) failed++;
  }
  const total = steps.length;
  const plural = total === 1 ? "" : "s";
  const label = steps.every((step) => step.kind === "reasoning") ? `${total} thought${plural}` : `${total} tool${plural} used`;
  return { label, failed, icons };
}

/** Latest running step in a run, else undefined. */
export function findLiveStep(steps: TimelineStep[]): TimelineStep | undefined {
  return [...steps].reverse().find((step) => step.status === "running");
}

/** Deepest running step, so a nested agent's live tool bubbles up to its parent line. */
export function findLiveDescendant(steps: TimelineStep[]): TimelineStep | undefined {
  const live = findLiveStep(steps);
  if (!live?.children) return live;
  return findLiveDescendant(live.children) ?? live;
}

const REASONING_FALLBACK_SUBJECT = "Reasoning";

/** "Reading settings.ts" etc. A reasoning step reads as its headline, or "Thinking". */
export function liveLabel(step: TimelineStep): string {
  if (step.kind === "reasoning") return step.subject === REASONING_FALLBACK_SUBJECT ? step.liveVerb : step.subject;
  return step.subject ? `${step.liveVerb} ${step.subject}` : step.liveVerb;
}

export interface PresentStandaloneStepOptions {
  isInteractive?: boolean;
  planStatus?: PlanStatus;
  dismissed?: boolean;
}

/**
 * Display overrides for questions and plans: a step awaiting the user reads as
 * running ("awaiting"), a handled one carries the outcome as its verb.
 */
export function presentStandaloneStep(step: TimelineStep, options: PresentStandaloneStepOptions): TimelineStep {
  if (step.kind === "question") {
    if (options.isInteractive) return { ...step, status: "running" };
    return { ...step, verb: options.dismissed ? "cancelled" : "answered" };
  }
  if (step.kind === "plan") {
    const status = options.planStatus ?? (options.isInteractive ? "interactive" : "approved");
    if (status === "interactive") return { ...step, status: "running" };
    return { ...step, verb: status };
  }
  return step;
}

function fileChangeActivityToToolCalls(activity: FileChangeActivity): ToolCall[] {
  if (activity.files.length === 0) {
    return [{
      id: activity.id,
      name: "Edit",
      input: JSON.stringify({ filename: "", diff: "", status: activity.status }),
      output: activity.status,
    }];
  }

  return activity.files.map((file, index) => ({
    id: `${activity.id}:${index}:${file.path}`,
    name: "Edit",
    input: JSON.stringify({
      filename: file.path,
      diff: file.diff ?? "",
      kind: file.kind,
      status: file.status ?? activity.status,
    }),
    output: file.diff ?? file.status ?? activity.status,
  }));
}


function hasFailedDescendant(step: TimelineStep): boolean {
  return step.children?.some((child) => child.status === "failed" || hasFailedDescendant(child)) ?? false;
}

function reasoningStep(id: string, segments: ReasoningSegment[], running: boolean): TimelineStep {
  const headline = [...segments].reverse().find((segment) => segment.headline)?.headline ?? "";
  return {
    id,
    kind: "reasoning",
    icon: "brain",
    liveVerb: "Thinking",
    verb: "thought",
    subject: headline || REASONING_FALLBACK_SUBJECT,
    status: running ? "running" : "completed",
    standalone: STANDALONE_KINDS.has("reasoning"),
    source: { type: "reasoning", segments },
  };
}

function activitySteps(activity: AgentActivity, streaming: boolean): TimelineStep[] {
  switch (activity.kind) {
    case "plan_update":
    case "goal_update":
      return [];
    case "command_execution": {
      const tool = commandExecutionActivityToToolCall(activity);
      return [{ ...describeTool(tool), id: tool.id, status: activityStatus(activity, streaming), stats: toolStats(tool), standalone: false, source: { type: "tool", tool } }];
    }
    case "file_change":
      return fileChangeActivityToToolCalls(activity).map((tool, index) => {
        const file = activity.files[index];
        return {
          ...describeTool(tool),
          id: tool.id,
          subject: file ? getFilename(file.path) : "(no file)",
          subjectTitle: file?.path,
          status: activityStatus({ status: file?.status ?? activity.status }, streaming),
          stats: toolStats(tool),
          standalone: false,
          source: { type: "tool", tool },
        };
      });
    case "diagnostic":
      return [{
        ...activityStep(activity, "diagnostic", "alert", "Reporting", "reported", activity.title, "completed"),
        severity: activity.severity === "info" ? undefined : activity.severity,
      }];
    case "image_view":
      return [activityStep(activity, "image", "image", "Viewing", "viewed", getFilename(activity.path), "completed")];
    case "image_generation": {
      // savedPath is the provider's scratch file (Codex generated_images/exec-<uuid>.png);
      // only a workspace-relative path is a meaningful subject.
      const path = activity.relativePath;
      const status = activity.status?.toLowerCase();
      const terminal = status === "completed" || status === "failed" || status === "error";
      const hasImage = Boolean(activity.imageUrl || activity.result);
      const stepStatus: StepStatus = streaming && !terminal && !hasImage ? "running"
        : status === "failed" || status === "error" ? "failed"
        : "completed";
      return [activityStep(activity, "image", "image", "Generating", "generated", path ? getFilename(path) : "image", stepStatus)];
    }
    case "context_compaction":
      return [activityStep(
        activity,
        "compaction",
        "fold",
        "Compacting",
        "compacted",
        "Context",
        streaming && activity.status !== "completed" ? "running" : "completed",
      )];
    case "subagent_activity": {
      const verbs = {
        started: ["Starting agent", "started"],
        interacted: ["Interacting", "interacted"],
        interrupted: ["Interrupting", "interrupted"],
        completed: ["Completing agent", "completed"],
      } as const;
      const [liveVerb, verb] = verbs[activity.activityKind];
      return [activityStep(activity, "subagent_activity", "bot", liveVerb, verb, activity.agentPath, "completed")];
    }
  }
}

function activityStep(
  activity: AgentActivity,
  kind: StepKind,
  icon: StepIcon,
  liveVerb: string,
  verb: string,
  subject: string,
  status: StepStatus,
): TimelineStep {
  return {
    id: activity.id,
    kind,
    icon,
    liveVerb,
    verb,
    subject,
    status,
    standalone: STANDALONE_KINDS.has(kind),
    source: { type: "activity", activity },
  };
}

function activityStatus(
  activity: { status?: string; exitCode?: number },
  streaming: boolean,
): StepStatus {
  if (streaming && (!activity.status || activity.status === "inProgress")) return "running";
  if (
    (activity.exitCode !== undefined && activity.exitCode !== 0)
    || activity.status === "failed"
    || activity.status === "error"
  ) {
    return "failed";
  }
  return "completed";
}

function toolStep(tool: ToolCall, context: BuildContext): TimelineStep {
  const described = describeTool(tool);
  const isAgent = described.kind === "agent";
  const children = isAgent
    ? (context.childrenMap.get(tool.id) ?? [])
      .filter((child) => !HIDDEN_TOOLS.has(child.name))
      .map((child) => toolStep(child, context))
    : undefined;
  const status = isAgent
    ? getSubAgentExecutionState(tool, {
      showExecutingState: context.streaming,
      children: context.childrenMap.get(tool.id),
      childrenMap: context.childrenMap,
    })
    : toolStatus(tool, context.streaming);
  return {
    ...described,
    id: tool.id,
    status,
    stats: toolStats(tool),
    standalone: STANDALONE_KINDS.has(described.kind),
    children,
    source: { type: "tool", tool },
  };
}

function toolStatus(tool: ToolCall, streaming: boolean): StepStatus {
  if (tool.isError || getBashMetadata(tool)?.failed) return "failed";
  if (tool.output === undefined) return streaming ? "running" : "pending";
  return "completed";
}

function toolStats(tool: ToolCall): StepStats | undefined {
  return getToolStats(tool) ?? undefined;
}

const COMMAND_SUBJECT_MAX = 50;

/** Drop shell wrappers (zsh -lc, quotes) and a leading `cd <dir> &&` so the subject shows the command that matters, then truncate. */
function commandSubject(command: string): string {
  const stripped = command
    .replace(/^(?:\S*\/)?(?:zsh|bash|sh)\s+-l?c\s+/, "")
    .replace(/^(["'])([\s\S]*)\1$/, "$2")
    .replace(/^cd\s+\S+\s*&&\s*/, "")
    .trim();
  return stripped.length > COMMAND_SUBJECT_MAX ? `${stripped.slice(0, COMMAND_SUBJECT_MAX)}...` : stripped;
}

type ToolDescription = Pick<TimelineStep, "kind" | "icon" | "liveVerb" | "verb" | "subject" | "subjectTitle">;

function describeTool(tool: ToolCall): ToolDescription {
  const generic: ToolDescription = { kind: "tool", icon: "wrench", liveVerb: "Calling", verb: "called", subject: tool.name };
  const input = parseToolInput(tool.input);
  if (!input) return generic;
  const detail = getToolDisplay(tool).detail ?? "";
  const filePath = (input.file_path ?? input.filename) as string | undefined;

  switch (tool.name) {
    case "Read":
      return { kind: "tool", icon: "file", liveVerb: "Reading", verb: "read", subject: detail, subjectTitle: filePath };
    case "Edit":
      return { kind: "tool", icon: "pencil", liveVerb: "Editing", verb: "edited", subject: detail, subjectTitle: filePath };
    case "Write":
      return { kind: "tool", icon: "file", liveVerb: "Writing", verb: "wrote", subject: detail, subjectTitle: filePath };
    case "Bash": {
      const command = input.command as string | undefined;
      return { kind: "tool", icon: "terminal", liveVerb: "Running", verb: "ran", subject: command ? commandSubject(command) : detail, subjectTitle: command };
    }
    case "Grep":
      return { kind: "tool", icon: "search", liveVerb: "Searching", verb: "searched", subject: (input.pattern as string | undefined) ?? "" };
    case "Glob":
      return { kind: "tool", icon: "search", liveVerb: "Searching", verb: "searched", subject: detail };
    case "WebFetch":
    case "WebSearch":
      return { kind: "tool", icon: "globe", liveVerb: "Fetching", verb: "fetched", subject: detail };
    case "TaskCreate":
    case "TaskList":
    case "TaskGet":
      return { kind: "tool", icon: "listChecks", liveVerb: "Tracking", verb: "tracked", subject: detail };
    case "Task":
    case "Agent": {
      const info = parseSubAgentInfo(tool);
      if (!info) break;
      return {
        kind: "agent",
        icon: "bot",
        liveVerb: "Delegating",
        verb: "delegated",
        subject: info.description || info.subagentType,
        subjectTitle: info.description || undefined,
      };
    }
    case "ExitPlanMode":
      return { kind: "plan", icon: "plan", liveVerb: "Awaiting", verb: "planned", subject: "Proposed plan" };
  }
  if (isAskUserQuestion(tool)) {
    return {
      kind: "question",
      icon: "question",
      liveVerb: "Awaiting",
      verb: "asked",
      subject: parseQuestions(tool)[0]?.question ?? "User input",
    };
  }
  return generic;
}
