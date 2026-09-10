import { describe, expect, it } from "vitest";
import type { ChatMessage, ToolCall } from "@/types";
import {
  buildTimelineRows,
  findLiveStep,
  liveLabel,
  presentStandaloneStep,
  summarizeRun,
  type TimelineRow,
  type TimelineStep,
} from "@/lib/timeline-steps";

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: "msg-1",
    sessionId: "session-1",
    role: "assistant",
    content: "",
    timestamp: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function tool(overrides: Partial<ToolCall> & { name: string; input: Record<string, unknown> }): ToolCall {
  const { input, ...rest } = overrides;
  return { id: `tool-${overrides.name}`, output: "ok", ...rest, input: JSON.stringify(input) };
}

function step(overrides: Partial<TimelineStep>): TimelineStep {
  return {
    id: "step",
    kind: "tool",
    icon: "file",
    liveVerb: "Reading",
    verb: "read",
    subject: "a.ts",
    status: "completed",
    standalone: false,
    source: { type: "tool", tool: tool({ name: "Read", input: {} }) },
    ...overrides,
  };
}

function runSteps(row: TimelineRow | undefined): TimelineStep[] {
  if (row?.type !== "run") throw new Error(`expected run row, got ${row?.type}`);
  return row.steps;
}

function singleStep(row: TimelineRow | undefined): TimelineStep {
  if (row?.type !== "step") throw new Error(`expected step row, got ${row?.type}`);
  return row.step;
}

describe("buildTimelineRows", () => {
  it("maps a Claude turn into text, runs, standalone steps and agent children", () => {
    const msg = message({
      reasoningSegments: [{ id: "r1:0", headline: "Plan the edit", body: "..." }],
      toolCalls: [
        tool({ id: "read", name: "Read", input: { file_path: "/repo/src/settings.ts" } }),
        tool({ id: "edit", name: "Edit", input: { file_path: "/repo/src/settings.ts", old_string: "a", new_string: "b\nc" } }),
        tool({ id: "bash", name: "Bash", input: { command: "npm test -- --run --reporter=verbose tests/lib/timeline-steps.test.ts", exitCode: 1 } }),
        tool({ id: "grep", name: "Grep", input: { pattern: "buildTimelineRows", path: "/repo/src" }, output: "a\nb" }),
        tool({ id: "todo", name: "TodoList", input: { items: [] } }),
        tool({ id: "agent", name: "Task", input: { subagent_type: "Explore", description: "find callers" }, output: undefined }),
        tool({ id: "child-read", name: "Read", input: { file_path: "/repo/b.ts" }, parentToolUseId: "agent" }),
        tool({ id: "child-update", name: "TaskUpdate", input: {}, parentToolUseId: "agent" }),
        tool({ id: "question", name: "AskUserQuestion", input: { questions: [{ question: "Which one?", options: [] }] }, output: undefined }),
      ],
      timeline: [
        { type: "reasoning", id: "r1" },
        { type: "text", id: "t1", text: "Let me look." },
        { type: "tool", id: "read" },
        { type: "tool", id: "edit" },
        { type: "tool", id: "bash" },
        { type: "tool", id: "grep" },
        { type: "tool", id: "todo" },
        { type: "tool", id: "missing" },
        { type: "text", id: "t2", text: "" },
        { type: "tool", id: "agent" },
        { type: "tool", id: "question" },
        { type: "text", id: "t3", text: "Done." },
      ],
    });

    const rows = buildTimelineRows(msg, { streaming: true });
    expect(rows.map((row) => row.type)).toEqual(["run", "text", "run", "step", "text"]);

    const reasoning = runSteps(rows[0])[0];
    expect(reasoning).toMatchObject({ kind: "reasoning", icon: "brain", verb: "thought", subject: "Plan the edit", status: "completed", standalone: false });
    expect(reasoning.source).toMatchObject({ type: "reasoning", segments: [{ id: "r1:0" }] });

    const steps = runSteps(rows[2]);
    expect(steps.map((s) => [s.id, s.verb, s.subject, s.status])).toEqual([
      ["read", "read", "settings.ts", "completed"],
      ["edit", "edited", "settings.ts", "completed"],
      ["bash", "ran", "npm test -- --run --reporter=verbose tests/lib/tim...", "failed"],
      ["grep", "searched", "buildTimelineRows", "completed"],
      ["agent", "delegated", "find callers", "running"],
    ]);
    expect(steps[0].subjectTitle).toBe("/repo/src/settings.ts");
    expect(steps[1].stats).toEqual({ type: "diff", added: 2, removed: 1 });
    expect(steps[2].subjectTitle).toBe("npm test -- --run --reporter=verbose tests/lib/timeline-steps.test.ts");
    expect(steps[3].stats).toEqual({ type: "plain", label: "2 results" });

    const agent = steps[4];
    expect(agent).toMatchObject({ kind: "agent", icon: "bot", subjectTitle: "find callers", standalone: false });
    expect(agent.children?.map((child) => [child.id, child.verb, child.subject])).toEqual([["child-read", "read", "b.ts"]]);

    expect(singleStep(rows[3])).toMatchObject({ kind: "question", icon: "question", liveVerb: "Awaiting", verb: "asked", subject: "Which one?", status: "running", standalone: true });
  });

  it("treats a trailing reasoning entry as running while streaming and marks pending tools when idle", () => {
    const msg = message({
      reasoningSegments: [{ id: "r1:0", body: "thinking" }],
      toolCalls: [tool({ id: "read", name: "Read", input: { file_path: "a.ts" }, output: undefined })],
      timeline: [
        { type: "tool", id: "read" },
        { type: "reasoning", id: "r1" },
      ],
    });
    const live = buildTimelineRows(msg, { streaming: true });
    expect(runSteps(live[0]).map((s) => s.status)).toEqual(["running", "running"]);
    expect(runSteps(live[0])[1]).toMatchObject({ kind: "reasoning", subject: "Reasoning" });

    const idle = buildTimelineRows(msg, { streaming: false });
    expect(runSteps(idle[0]).map((s) => s.status)).toEqual(["pending", "completed"]);
  });

  it("hides the plan write tool and maps ExitPlanMode to a standalone plan step", () => {
    const msg = message({
      toolCalls: [
        tool({ id: "write", name: "Write", input: { file_path: "/repo/.claude/plans/plan.md", content: "# Plan" } }),
        tool({ id: "exit", name: "ExitPlanMode", input: {} }),
      ],
      timeline: [
        { type: "tool", id: "write" },
        { type: "tool", id: "exit" },
      ],
    });
    const rows = buildTimelineRows(msg, { streaming: false });
    expect(rows).toHaveLength(1);
    expect(singleStep(rows[0])).toMatchObject({ kind: "plan", icon: "plan", liveVerb: "Awaiting", verb: "planned", subject: "Proposed plan" });
  });

  it("maps Codex activities to steps with the same verbs as Claude tools", () => {
    const msg = message({
      agentActivities: [
        {
          id: "cmd-read",
          kind: "command_execution",
          command: "cat src/app.ts",
          status: "completed",
          commandActions: [{ type: "read", command: "cat src/app.ts", path: "src/app.ts" }],
        },
        { id: "cmd-run", kind: "command_execution", command: "npm test", status: "inProgress" },
        {
          id: "change",
          kind: "file_change",
          status: "completed",
          files: [
            { path: "src/a.ts", diff: "--- a\n+++ b\n+one\n+two\n-three" },
            { path: "src/b.ts", diff: "", status: "failed" },
          ],
        },
        { id: "empty-change", kind: "file_change", status: "completed", files: [] },
        { id: "diag", kind: "diagnostic", severity: "warning", title: "Rate limited", message: "slow down" },
        { id: "plan", kind: "plan_update", steps: [] },
        { id: "compact", kind: "context_compaction", status: "inProgress" },
        { id: "sub", kind: "subagent_activity", activityKind: "started", agentThreadId: "t", agentPath: "root/worker" },
        { id: "img", kind: "image_generation", status: "inProgress" },
      ],
      timeline: [
        { type: "activity", id: "cmd-read" },
        { type: "activity", id: "cmd-run" },
        { type: "activity", id: "change" },
        { type: "activity", id: "empty-change" },
        { type: "activity", id: "diag" },
        { type: "activity", id: "plan" },
        { type: "activity", id: "compact" },
        { type: "activity", id: "sub" },
        { type: "activity", id: "img" },
      ],
    });

    const rows = buildTimelineRows(msg, { streaming: true });
    expect(rows.map((row) => row.type)).toEqual(["run", "step", "run"]);

    const steps = runSteps(rows[0]);
    expect(steps.map((s) => [s.id, s.verb, s.subject, s.status])).toEqual([
      ["cmd-read", "read", "app.ts", "completed"],
      ["cmd-run", "ran", "npm test", "running"],
      ["change:0:src/a.ts", "edited", "a.ts", "completed"],
      ["change:1:src/b.ts", "edited", "b.ts", "failed"],
      ["empty-change", "edited", "(no file)", "completed"],
    ]);
    expect(steps[0].source).toMatchObject({ type: "tool", tool: { name: "Read" } });
    expect(steps[2].stats).toEqual({ type: "diff", added: 2, removed: 1 });
    expect(steps[2].subjectTitle).toBe("src/a.ts");

    expect(singleStep(rows[1])).toMatchObject({ kind: "diagnostic", icon: "alert", verb: "reported", subject: "Rate limited", severity: "warning", standalone: true });
    const tail = runSteps(rows[2]);
    expect(tail[0]).toMatchObject({ kind: "compaction", icon: "fold", liveVerb: "Compacting", verb: "compacted", subject: "Context", status: "running", standalone: false });
    expect(tail[1]).toMatchObject({ kind: "subagent_activity", icon: "bot", liveVerb: "Starting agent", verb: "started", subject: "root/worker", standalone: false });
    expect(tail[2]).toMatchObject({ kind: "image", verb: "generated", subject: "image", status: "running", standalone: false });

    const idle = buildTimelineRows(msg, { streaming: false });
    expect(runSteps(idle[0])[1].status).toBe("completed");
    expect(runSteps(idle[2]).map((s) => s.status)).toEqual(["completed", "completed", "completed"]);
  });

  it("synthesizes diagnostics, reasoning, text, tools then activities for legacy messages", () => {
    const msg = message({
      content: "Legacy answer",
      reasoningSegments: [{ id: "a", headline: "First" }, { id: "b", headline: "Second" }],
      toolCalls: [
        tool({ id: "todo", name: "TodoList", input: { items: [] } }),
        tool({ id: "read", name: "Read", input: { file_path: "a.ts" } }),
        tool({ id: "sleep", name: "Bash", input: { command: "sleep 300", status: "completed" }, output: "" }),
      ],
      agentActivities: [
        { id: "view", kind: "image_view", path: "/repo/shot.png" },
        // Codex persisted this command as both a tool call and an activity: rendered once.
        { id: "sleep", kind: "command_execution", command: "sleep 300", status: "completed" },
        { id: "cmd", kind: "command_execution", command: "ls", status: "completed" },
        { id: "diag", kind: "diagnostic", severity: "warning", title: "Config warning", message: "check" },
      ],
    });

    const rows = buildTimelineRows(msg, { streaming: false });
    expect(rows.map((row) => row.type)).toEqual(["step", "run", "text", "run"]);
    expect(singleStep(rows[0])).toMatchObject({ kind: "diagnostic", subject: "Config warning" });
    expect(runSteps(rows[1])[0]).toMatchObject({ id: "reasoning", subject: "Second" });
    expect(rows[2]).toMatchObject({ type: "text", text: "Legacy answer" });
    expect(runSteps(rows[3]).map((s) => s.id)).toEqual(["read", "sleep", "view", "cmd"]);
    expect(runSteps(rows[3])[2]).toMatchObject({ kind: "image", verb: "viewed", subject: "shot.png" });
  });

  it("leaves info diagnostics without a severity mark", () => {
    const rows = buildTimelineRows(message({
      agentActivities: [{ id: "diag", kind: "diagnostic", severity: "info", title: "Note", message: "fyi" }],
    }), { streaming: false });
    expect(singleStep(rows[0]).severity).toBeUndefined();
  });

  it("skips the legacy reasoning step when segments carry no content", () => {
    const rows = buildTimelineRows(message({ content: "Hi", reasoningSegments: [{ id: "a" }] }), { streaming: false });
    expect(rows).toEqual([{ type: "text", id: "text:msg-1", text: "Hi" }]);
  });
});

describe("describeTool", () => {
  function describe_(t: ToolCall): TimelineStep {
    const msg = message({ toolCalls: [t], timeline: [{ type: "tool", id: t.id }] });
    const rows = buildTimelineRows(msg, { streaming: false });
    const row = rows[0];
    if (row?.type === "run") return row.steps[0];
    return singleStep(row);
  }

  it("maps web, task tracking, MCP and unknown tools to their icon, verb and subject", () => {
    expect(describe_(tool({ id: "fetch", name: "WebFetch", input: { url: "https://hive.dev", prompt: "summarize" } })))
      .toMatchObject({ icon: "globe", verb: "fetched", subject: "https://hive.dev" });
    expect(describe_(tool({ id: "search", name: "WebSearch", input: { query: "vitest mocks" } })))
      .toMatchObject({ icon: "globe", verb: "fetched", subject: "vitest mocks" });
    expect(describe_(tool({ id: "create", name: "TaskCreate", input: { subject: "Fix login bug", description: "Auth fails" } })))
      .toMatchObject({ icon: "listChecks", verb: "tracked", subject: "Fix login bug" });
    expect(describe_(tool({ id: "get", name: "TaskGet", input: { taskId: "9" } }))).toMatchObject({ verb: "tracked", subject: "#9" });
    expect(describe_(tool({ id: "get-none", name: "TaskGet", input: {} }))).toMatchObject({ verb: "tracked", subject: "" });
    expect(describe_(tool({ id: "mcp", name: "mcp__github__create_issue", input: { title: "x" } })))
      .toMatchObject({ icon: "wrench", liveVerb: "Calling", verb: "called", subject: "mcp__github__create_issue" });
  });

  it("falls back to a generic called step when the input is not JSON, including for Task", () => {
    expect(describe_({ id: "bad-bash", name: "Bash", input: "{not-json", output: "result" }))
      .toMatchObject({ kind: "tool", icon: "wrench", verb: "called", subject: "Bash" });
    const task = describe_({ id: "bad-task", name: "Task", input: "not json at all", output: "x" });
    expect(task).toMatchObject({ kind: "tool", icon: "wrench", subject: "Task" });
    expect(task.children).toBeUndefined();
  });

  it("uses the agent type alone as subject when the description is empty", () => {
    expect(describe_(tool({ id: "agent", name: "Task", input: { subagent_type: "Explore", description: "" } })))
      .toMatchObject({ kind: "agent", subject: "Explore", subjectTitle: undefined });
  });

  it("drops top-level TaskUpdate and TodoList tools and children of non-agent tools", () => {
    const msg = message({
      toolCalls: [
        tool({ id: "read", name: "Read", input: { file_path: "/a" } }),
        tool({ id: "update", name: "TaskUpdate", input: { taskId: "1", status: "completed" } }),
        tool({ id: "todo", name: "TodoList", input: { items: [] } }),
        tool({ id: "orphan", name: "Read", input: { file_path: "/b" }, parentToolUseId: "read" }),
      ],
      timeline: [
        { type: "tool", id: "read" },
        { type: "tool", id: "update" },
        { type: "tool", id: "todo" },
        { type: "tool", id: "orphan" },
      ],
    });
    const rows = buildTimelineRows(msg, { streaming: false });
    expect(rows).toHaveLength(1);
    expect(runSteps(rows[0]).map((s) => s.id)).toEqual(["read"]);
  });

  it("maps every Codex subagent activity kind to its verb", () => {
    const kinds = [
      ["started", "Starting agent", "started"],
      ["interacted", "Interacting", "interacted"],
      ["interrupted", "Interrupting", "interrupted"],
    ] as const;
    for (const [activityKind, liveVerb, verb] of kinds) {
      const msg = message({
        agentActivities: [{ id: "sub", kind: "subagent_activity", activityKind, agentThreadId: "t", agentPath: "root/worker" }],
        timeline: [{ type: "activity", id: "sub" }],
      });
      expect(runSteps(buildTimelineRows(msg, { streaming: true })[0])[0])
        .toMatchObject({ kind: "subagent_activity", icon: "bot", liveVerb, verb, subject: "root/worker", status: "completed" });
    }
  });
});

describe("summarizeRun", () => {
  it("counts steps once each, agents included, and failures including agent descendants", () => {
    const steps = [
      step({ id: "1", verb: "read", icon: "file" }),
      step({ id: "2", verb: "read", icon: "file" }),
      step({ id: "3", verb: "edited", icon: "pencil", status: "failed" }),
      step({ id: "4", verb: "ran", icon: "terminal" }),
      step({ id: "5", verb: "searched", icon: "search" }),
      step({
        id: "6",
        kind: "agent",
        verb: "delegated",
        icon: "bot",
        children: [step({ id: "6a", status: "failed" })],
      }),
    ];
    expect(summarizeRun(steps)).toEqual({
      label: "6 tools used",
      failed: 2,
      icons: ["file", "pencil", "terminal", "search", "bot"],
    });
  });

  it("labels a reasoning-only run as thoughts", () => {
    const thoughts = [1, 2, 3].map((n) => step({ id: String(n), kind: "reasoning", verb: "thought", icon: "brain" }));
    expect(summarizeRun(thoughts).label).toBe("3 thoughts");
    expect(summarizeRun([thoughts[0], step({ id: "x" })]).label).toBe("2 tools used");
  });
});

describe("findLiveStep and liveLabel", () => {
  it("returns the last running step and its label", () => {
    const steps = [
      step({ id: "1", status: "running", liveVerb: "Reading", subject: "a.ts" }),
      step({ id: "2", status: "completed" }),
      step({ id: "3", status: "running", liveVerb: "Running", subject: "npm test" }),
      step({ id: "4", status: "pending" }),
    ];
    const live = findLiveStep(steps);
    expect(live?.id).toBe("3");
    expect(liveLabel(live!)).toBe("Running npm test");
    expect(liveLabel(step({ liveVerb: "Thinking", subject: "" }))).toBe("Thinking");
    expect(findLiveStep([step({ status: "completed" })])).toBeUndefined();
  });
});

describe("presentStandaloneStep", () => {
  const question = step({ kind: "question", liveVerb: "Awaiting", verb: "asked", status: "completed", standalone: true });
  const plan = step({ kind: "plan", liveVerb: "Awaiting", verb: "planned", status: "pending", standalone: true });

  it("marks an interactive question as running and a handled one with its outcome", () => {
    expect(presentStandaloneStep(question, { isInteractive: true })).toMatchObject({ status: "running", verb: "asked" });
    expect(presentStandaloneStep(question, {})).toMatchObject({ status: "completed", verb: "answered" });
    expect(presentStandaloneStep(question, { dismissed: true })).toMatchObject({ verb: "cancelled" });
  });

  it("derives the plan state from planStatus, falling back to the interactive flag", () => {
    expect(presentStandaloneStep(plan, { isInteractive: true })).toMatchObject({ status: "running", verb: "planned" });
    expect(presentStandaloneStep(plan, { planStatus: "approved", isInteractive: true })).toMatchObject({ status: "pending", verb: "approved" });
    expect(presentStandaloneStep(plan, { planStatus: "revised" })).toMatchObject({ verb: "revised" });
    expect(presentStandaloneStep(plan, {})).toMatchObject({ verb: "approved" });
  });

  it("passes every other step through untouched", () => {
    const reasoning = step({ kind: "reasoning", standalone: true });
    expect(presentStandaloneStep(reasoning, { isInteractive: true, dismissed: true })).toBe(reasoning);
  });
});
