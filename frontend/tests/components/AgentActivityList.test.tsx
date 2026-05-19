import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentActivityList } from "@/components/chat/AgentActivityList";
import type { AgentActivity } from "@/types";

describe("AgentActivityList", () => {
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

  it("keeps tool-like activities expanded while streaming", () => {
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

    expect(screen.queryByText("3 tool calls")).not.toBeInTheDocument();
    expect(screen.getAllByText("Bash")).toHaveLength(2);
    expect(screen.getByText("Edit")).toBeInTheDocument();
  });

  it("renders plan update steps", () => {
    const activities: AgentActivity[] = [{
      id: "plan-1",
      kind: "plan_update",
      steps: [
        { text: "Inspect", status: "completed" },
        { text: "Implement", status: "inProgress" },
      ],
    }];

    render(<AgentActivityList activities={activities} />);

    expect(screen.getByText("Plan")).toBeInTheDocument();
    expect(screen.getByText("1/2 complete")).toBeInTheDocument();
    expect(screen.getByText("Inspect")).toBeInTheDocument();
    expect(screen.getByText("Implement")).toBeInTheDocument();
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
