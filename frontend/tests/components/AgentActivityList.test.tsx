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

  it("renders image view activities with a thumbnail preview", async () => {
    const user = userEvent.setup();
    const activities: AgentActivity[] = [{
      id: "img-1",
      kind: "image_view",
      path: "/tmp/project/assets/screenshot.png",
      relativePath: "assets/screenshot.png",
      imageUrl: "/api/workspaces/ws-1/file/raw?path=assets%2Fscreenshot.png",
    }];

    render(<AgentActivityList activities={activities} />);

    expect(screen.getByText("View image")).toBeInTheDocument();
    expect(screen.getByText("screenshot.png")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /View image/ }));

    const image = screen.getByRole("img", { name: "screenshot.png" });
    expect(image).toHaveAttribute("src", expect.stringContaining("/api/workspaces/ws-1/file/raw"));
  });

  it("explains when a viewed image is outside the workspace", async () => {
    const user = userEvent.setup();
    const activities: AgentActivity[] = [{
      id: "img-1",
      kind: "image_view",
      path: "/var/data/elsewhere.png",
      outsideWorkspace: true,
    }];

    render(<AgentActivityList activities={activities} />);

    await user.click(screen.getByRole("button", { name: /View image/ }));

    expect(screen.getByText("Image is outside the workspace and cannot be previewed.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows the in-progress state for image generations", () => {
    const activities: AgentActivity[] = [{
      id: "gen-1",
      kind: "image_generation",
      status: "inProgress",
    }];

    render(<AgentActivityList activities={activities} showExecutingState />);

    expect(screen.getByText("Generate image")).toBeInTheDocument();
    expect(screen.getByText("generating…")).toBeInTheDocument();
  });

  it("renders generated images with the revised prompt on expand", async () => {
    const user = userEvent.setup();
    const activities: AgentActivity[] = [{
      id: "gen-1",
      kind: "image_generation",
      status: "completed",
      revisedPrompt: "A hive logo in watercolor",
      result: "aGVsbG8=",
      savedPath: "/tmp/project/generated/logo.png",
      relativePath: "generated/logo.png",
      imageUrl: "/api/workspaces/ws-1/file/raw?path=generated%2Flogo.png",
    }];

    render(<AgentActivityList activities={activities} />);

    expect(screen.getByText("Generated image")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Generate image/ }));

    expect(screen.getByText("A hive logo in watercolor")).toBeInTheDocument();
    const image = screen.getByRole("img", { name: "A hive logo in watercolor" });
    expect(image).toHaveAttribute("src", expect.stringContaining("/api/workspaces/ws-1/file/raw"));
  });

  it("falls back to an inline data URL when a generation has no saved file", async () => {
    const user = userEvent.setup();
    const activities: AgentActivity[] = [{
      id: "gen-1",
      kind: "image_generation",
      status: "completed",
      result: "aGVsbG8=",
    }];

    render(<AgentActivityList activities={activities} />);

    await user.click(screen.getByRole("button", { name: /Generate image/ }));

    expect(screen.getByRole("img", { name: "Generated image" }))
      .toHaveAttribute("src", "data:image/png;base64,aGVsbG8=");
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
