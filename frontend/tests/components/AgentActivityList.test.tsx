import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentActivityList } from "@/components/chat/AgentActivityList";
import type { AgentActivity, ToolCall } from "@/types";

function tool(overrides: Partial<ToolCall>): ToolCall {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    name: overrides.name ?? "Read",
    input: overrides.input ?? "{}",
    ...overrides,
  };
}

describe("AgentActivityList", () => {
  it.each([
    ["started", "Started sub-agent"],
    ["interacted", "Interacted with sub-agent"],
    ["interrupted", "Interrupted sub-agent"],
  ] as const)("renders %s sub-agent activity with an accessible path chip", (activityKind, title) => {
    const agentPath = "/workspace/agents/research/very/long/sub-agent/thread/path";

    render(
      <AgentActivityList
        activities={[{
          id: `subagent-${activityKind}`,
          kind: "subagent_activity",
          activityKind,
          agentThreadId: "thread-1",
          agentPath,
        }]}
      />,
    );

    const row = screen.getByRole("button", { name: new RegExp(title) });
    expect(row).toBeInTheDocument();
    expect(row).not.toHaveAttribute("aria-expanded");
    expect(screen.getByTitle(agentPath)).toHaveAttribute("aria-label", `Agent path: ${agentPath}`);
    expect(screen.queryByText("Unsupported App Server event")).not.toBeInTheDocument();
  });

  it("renders an in-progress context compaction while the turn is live", () => {
    render(
      <AgentActivityList
        activities={[{ id: "compaction-1", kind: "context_compaction", status: "inProgress" }]}
        showExecutingState
      />,
    );

    const row = screen.getByRole("button", { name: /Compacting context…/ });
    expect(row).not.toHaveAttribute("aria-expanded");
    expect(row).toHaveAttribute("title", "Older messages were summarized to free up context");
  });

  it.each([
    ["a completed compaction in a live turn", "completed", true],
    ["a stale in-progress compaction after the turn ended", "inProgress", false],
  ] as const)("renders %s as compacted", (_label, status, showExecutingState) => {
    render(
      <AgentActivityList
        activities={[{ id: "compaction-1", kind: "context_compaction", status }]}
        showExecutingState={showExecutingState}
      />,
    );

    expect(screen.getByRole("button", { name: /Context compacted/ })).toBeInTheDocument();
  });

  it("renders command activity with streaming output", async () => {
    const user = userEvent.setup();
    const activities: AgentActivity[] = [{
      id: "cmd-1",
      kind: "command_execution",
      command: "npm test",
      cwd: "/tmp/project",
      status: "completed",
      output: "ok\n",
      exitCode: 0,
      durationMs: 1200,
    }];

    render(<AgentActivityList activities={activities} />);

    expect(screen.queryByText("Command")).not.toBeInTheDocument();
    expect(screen.getByText("Bash")).toBeInTheDocument();
    expect(screen.getByText("npm test")).toBeInTheDocument();
    expect(screen.queryByText("exit 0")).not.toBeInTheDocument();
    expect(screen.queryByText("1.2s")).not.toBeInTheDocument();

    const button = screen.getByRole("button", { name: /Bash/ });
    expect(button).toHaveAttribute("aria-expanded", "false");

    await user.click(button);

    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/\$ npm test/)).toBeInTheDocument();
    expect(screen.getByText(/cwd: \/tmp\/project/)).toBeInTheDocument();
    expect(screen.getByText("ok")).toBeInTheDocument();
  });

  it("renders single Codex read command actions as Read tools", async () => {
    const user = userEvent.setup();
    const activities: AgentActivity[] = [{
      id: "cmd-read",
      kind: "command_execution",
      command: "cat README.md",
      cwd: "/tmp/project",
      status: "completed",
      output: "# Demo\n",
      exitCode: 0,
      commandActions: [{
        type: "read",
        command: "cat README.md",
        name: "cat",
        path: "/tmp/project/README.md",
      }],
    }];

    render(<AgentActivityList activities={activities} />);

    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(screen.queryByText("Bash")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Read/ }));

    expect(screen.getByText(/Path: \/tmp\/project\/README\.md/)).toBeInTheDocument();
    expect(screen.getByText(/\$ cat README\.md/)).toBeInTheDocument();
    expect(screen.getByText("# Demo")).toBeInTheDocument();
  });

  it("renders file changes through the shared Edit tool display", async () => {
    const user = userEvent.setup();
    const activities: AgentActivity[] = [{
      id: "files-1",
      kind: "file_change",
      status: "completed",
      files: [{
        path: "src/app.ts",
        kind: "update",
        diff: "--- a/src/app.ts\n+++ b/src/app.ts\n-old\n+new",
      }],
    }];

    render(<AgentActivityList activities={activities} />);

    expect(screen.queryByText("File changes")).not.toBeInTheDocument();
    expect(screen.getByText("Edit")).toBeInTheDocument();
    expect(screen.getByText("app.ts")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("−1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Edit/ }));

    expect(screen.getByText(/\+new/)).toBeInTheDocument();
    expect(screen.getByText(/-old/)).toBeInTheDocument();
  });

  it("collapses completed tool-like activities into the shared summary", async () => {
    const user = userEvent.setup();
    const activities: AgentActivity[] = [
      {
        id: "cmd-1",
        kind: "command_execution",
        command: "npm test",
        status: "completed",
        output: "ok",
      },
      {
        id: "cmd-2",
        kind: "command_execution",
        command: "npm run lint",
        status: "completed",
        output: "ok",
      },
      {
        id: "files-1",
        kind: "file_change",
        status: "completed",
        files: [{
          path: "src/app.ts",
          kind: "update",
          diff: "--- a/src/app.ts\n+++ b/src/app.ts\n-old\n+new",
        }],
      },
    ];

    render(<AgentActivityList activities={activities} />);

    expect(screen.getByText("3 tool calls")).toBeInTheDocument();
    expect(screen.queryByText("Bash")).not.toBeInTheDocument();
    expect(screen.queryByText("Edit")).not.toBeInTheDocument();

    await user.click(screen.getByText("3 tool calls"));

    expect(screen.getAllByText("Bash")).toHaveLength(2);
    expect(screen.getByText("Edit")).toBeInTheDocument();
  });

  it("keeps provided tool calls and activity tools in one summary before diagnostics", () => {
    const activities: AgentActivity[] = [
      {
        id: "cmd-1",
        kind: "command_execution",
        command: "npm test",
        status: "completed",
        output: "ok",
      },
      {
        id: "cmd-2",
        kind: "command_execution",
        command: "npm run lint",
        status: "completed",
        output: "ok",
      },
      {
        id: "diag-1",
        kind: "diagnostic",
        severity: "warning",
        title: "Unsupported App Server event",
        message: "Hive does not render this event yet.",
        method: "thread/status/changed",
      },
    ];

    render(
      <AgentActivityList
        activities={activities}
        toolCalls={[
          tool({
            id: "agent-1",
            name: "Agent",
            input: JSON.stringify({ subagent_type: "Agent", description: "Inspect auth" }),
          }),
        ]}
      />,
    );

    const summary = screen.getByText("2 tool calls, 1 subagent");
    const diagnostic = screen.getByText("Unsupported App Server event");
    expect(summary.compareDocumentPosition(diagnostic) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText("1 subagent")).not.toBeInTheDocument();
  });

  it("does not duplicate activity tools that already have provided tool calls", () => {
    const activities: AgentActivity[] = [
      {
        id: "files-1",
        kind: "file_change",
        status: "completed",
        files: [{
          path: "src/app.ts",
          kind: "update",
          diff: "--- a/src/app.ts\n+++ b/src/app.ts\n-old\n+new",
        }],
      },
    ];

    render(
      <AgentActivityList
        activities={activities}
        toolCalls={[
          tool({ id: "files-1", name: "Edit", input: JSON.stringify({ filename: "src/app.ts", diff: "diff" }) }),
          tool({ id: "read-1", name: "Read", input: JSON.stringify({ file_path: "src/app.ts" }) }),
          tool({ id: "grep-1", name: "Grep", input: JSON.stringify({ pattern: "app" }) }),
        ]}
      />,
    );

    expect(screen.getByText("3 tool calls")).toBeInTheDocument();
    expect(screen.queryByText("4 tool calls")).not.toBeInTheDocument();
  });

  it("collapses tool-like activities while streaming when threshold is reached", () => {
    const activities: AgentActivity[] = [
      {
        id: "cmd-1",
        kind: "command_execution",
        command: "npm test",
        status: "inProgress",
      },
      {
        id: "cmd-2",
        kind: "command_execution",
        command: "npm run lint",
        status: "completed",
        output: "ok",
      },
      {
        id: "files-1",
        kind: "file_change",
        status: "completed",
        files: [{
          path: "src/app.ts",
          kind: "update",
          diff: "--- a/src/app.ts\n+++ b/src/app.ts\n-old\n+new",
        }],
      },
    ];

    render(<AgentActivityList activities={activities} showExecutingState />);

    expect(screen.getByText("3 tool calls")).toBeInTheDocument();
    expect(screen.queryByText("Bash")).not.toBeInTheDocument();
    expect(screen.queryByText("Edit")).not.toBeInTheDocument();
  });

  it("omits plan update activities because the task tracker owns plan display", () => {
    const activities: AgentActivity[] = [{
      id: "plan-1",
      kind: "plan_update",
      steps: [
        { text: "Inspect", status: "completed" },
        { text: "Implement", status: "inProgress" },
      ],
    }];

    const { container } = render(<AgentActivityList activities={activities} />);

    expect(container.firstChild).toBeNull();
    expect(screen.queryByText("Plan")).not.toBeInTheDocument();
    expect(screen.queryByText("Inspect")).not.toBeInTheDocument();
    expect(screen.queryByText("Implement")).not.toBeInTheDocument();
  });

  it("renders diagnostic activities with details", async () => {
    const user = userEvent.setup();
    const activities: AgentActivity[] = [{
      id: "diag-1",
      kind: "diagnostic",
      severity: "warning",
      title: "Unsupported App Server event",
      message: "Hive does not render this event yet.",
      source: "codex_app_server",
      method: "turn/diff/updated",
      details: "{\"changedFiles\":2}",
    }];

    render(<AgentActivityList activities={activities} />);

    expect(screen.getByText("Unsupported App Server event")).toBeInTheDocument();
    expect(screen.getByText("turn/diff/updated")).toBeInTheDocument();
    expect(screen.getByLabelText("Diagnostic warning")).toBeInTheDocument();
    expect(screen.queryByText("Warning")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Unsupported App Server event/ }));

    expect(screen.getByText(/Hive does not render this event yet/)).toBeInTheDocument();
    expect(screen.getByText(/{\"changedFiles\":2}/)).toBeInTheDocument();
  });
});
