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

    expect(screen.getByText("Command")).toBeInTheDocument();
    expect(screen.getByText("npm test")).toBeInTheDocument();

    const button = screen.getByRole("button", { name: /Command/ });
    expect(button).toHaveAttribute("aria-expanded", "false");

    await user.click(button);

    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("$ npm test")).toBeInTheDocument();
    expect(screen.getByText("cwd: /tmp/project")).toBeInTheDocument();
    expect(screen.getByText("ok")).toBeInTheDocument();
    expect(screen.getByText("exit 0")).toBeInTheDocument();
  });

  it("renders file changes with diffs", async () => {
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

    expect(screen.getByText("File changes")).toBeInTheDocument();
    expect(screen.getByText("1 file")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("-1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /File changes/ }));

    expect(screen.getByText("Path: src/app.ts")).toBeInTheDocument();
    expect(screen.getByText("+new")).toBeInTheDocument();
    expect(screen.getByText("-old")).toBeInTheDocument();
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

    await user.click(screen.getByRole("button", { name: /Unsupported App Server event/ }));

    expect(screen.getByText("Hive does not render this event yet.")).toBeInTheDocument();
    expect(screen.getByText("{\"changedFiles\":2}")).toBeInTheDocument();
  });
});
