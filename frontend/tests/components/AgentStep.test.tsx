import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AssistantTimeline } from "@/components/chat/AssistantTimeline";
import type { ChatMessage as Message, ToolCall } from "@/types";

vi.mock("@/components/ai-elements/message", () => ({
  MessageResponse: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const resultBlocks = JSON.stringify([{ type: "text", text: "## Summary\n\nFound **3** callers" }]);

function agentTool(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: "agent",
    name: "Task",
    input: JSON.stringify({ subagent_type: "Explore", description: "Review settings", prompt: "Look at settings.ts" }),
    output: resultBlocks,
    ...overrides,
  };
}

const readChild: ToolCall = { id: "child-read", parentToolUseId: "agent", name: "Read", input: '{"file_path":"src/settings.ts"}', output: "read" };
const bashChild: ToolCall = { id: "child-bash", parentToolUseId: "agent", name: "Bash", input: '{"command":"npm test"}' };

function message(toolCalls: ToolCall[], extra: Partial<Message> = {}): Message {
  return {
    id: "turn-1", sessionId: "session-1", role: "assistant", timestamp: "2026-09-08T10:00:00Z", content: "",
    timeline: toolCalls.filter((tool) => !tool.parentToolUseId).map((tool) => ({ type: "tool", id: tool.id })),
    toolCalls,
    ...extra,
  };
}

const agentLine = () => screen.getByRole("button", { name: /^Explore Review settings/ });

describe("AgentStep", () => {
  it("shows the running agent's live child on the live header", async () => {
    const running = agentTool({ output: undefined });
    const { rerender } = render(<AssistantTimeline message={message([running, { ...readChild, output: undefined }])} streaming />);
    expect(screen.getByTestId("live-line")).toHaveTextContent(/Review settings.*delegating.*Reading settings\.ts/);

    rerender(<AssistantTimeline message={message([running, readChild, bashChild])} streaming />);
    await waitFor(() => expect(screen.getByTestId("live-line")).toHaveTextContent(/Running npm test/));
    expect(screen.queryByText("Prompt")).not.toBeInTheDocument();
  });

  it("expands a completed agent into Prompt, children and a markdown Result", async () => {
    const user = userEvent.setup();
    render(<AssistantTimeline message={message([agentTool(), readChild])} />);
    const line = screen.getByRole("button", { name: "Explore Review settings · 1 tool" });
    expect(within(line).getByText("Explore").className).toContain("font-mono");
    expect(screen.queryByText("Prompt")).not.toBeInTheDocument();
    expect(screen.queryByText("settings.ts")).not.toBeInTheDocument();

    await user.click(line);
    const prompt = screen.getByRole("button", { name: "Prompt" });
    const child = screen.getByRole("button", { name: /^settings\.ts/ });
    const result = screen.getByRole("button", { name: "Result" });
    expect(prompt.compareDocumentPosition(child) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(child.compareDocumentPosition(result) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(prompt).queryByText("delegated")).not.toBeInTheDocument();

    await user.click(result);
    expect(screen.getByText(/Found \*\*3\*\* callers/)).toBeVisible();
    await user.click(prompt);
    expect(screen.getByText("Look at settings.ts")).toBeVisible();

    await user.click(line);
    expect(screen.getByText("Look at settings.ts")).not.toBeVisible();
  });

  it("marks a failed agent and labels its output as Failure", async () => {
    const user = userEvent.setup();
    render(<AssistantTimeline message={message([agentTool({ output: "boom", isError: true }), readChild])} />);
    expect(screen.getByLabelText("Review settings failed")).toBeVisible();
    await user.click(agentLine());
    await user.click(screen.getByRole("button", { name: "Failure" }));
    expect(screen.getByText("boom")).toBeVisible();
  });

  it("renders nested agents recursively under their own rail", async () => {
    const user = userEvent.setup();
    const nested: ToolCall = {
      id: "nested", parentToolUseId: "agent", name: "Agent",
      input: JSON.stringify({ subagent_type: "Plan", description: "Draft plan" }), output: "planned",
    };
    render(<AssistantTimeline message={message([agentTool(), nested, { ...readChild, parentToolUseId: "nested" }])} />);
    await user.click(agentLine());
    const nestedLine = screen.getByRole("button", { name: "Plan Draft plan · 1 tool" });
    expect(screen.queryByText("settings.ts")).not.toBeInTheDocument();
    await user.click(nestedLine);
    expect(screen.getByRole("button", { name: /^settings\.ts/ })).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Result" })).toHaveLength(2);
  });

  it("shows the running agent only on the live header, with its live child, until the header moves on", async () => {
    const user = userEvent.setup();
    const read: ToolCall = { id: "read", name: "Read", input: '{"file_path":"src/app.ts"}', output: "read" };
    const edit: ToolCall = { id: "edit", name: "Edit", input: '{"file_path":"src/app.ts","old_string":"a","new_string":"b"}', output: "edited" };
    const live = message([read, edit, agentTool({ output: undefined }), { ...readChild, output: undefined }]);
    const { rerender } = render(<AssistantTimeline message={live} streaming />);
    const header = screen.getByTestId("live-line");
    expect(header).toHaveTextContent(/Review settings.*delegating.*Reading settings\.ts/);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /^Explore Review settings/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^app\.ts/ })).not.toBeInTheDocument();

    await user.click(header);
    // The agent is the header's step: only the finished Read and Edit lines are listed.
    expect(screen.queryByRole("button", { name: /^Explore Review settings/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^app\.ts/ })).toHaveLength(2);

    rerender(<AssistantTimeline message={message([read, edit, agentTool(), readChild])} streaming={false} />);
    expect(screen.getByRole("button", { name: /3 tools used/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("button", { name: /^Explore Review settings/ })).toHaveLength(1);
  });

  it("renders Codex subagent activity as a plain line inside the run", async () => {
    const user = userEvent.setup();
    const tools: ToolCall[] = [
      { id: "read", name: "Read", input: '{"file_path":"src/app.ts"}', output: "read" },
      { id: "edit", name: "Edit", input: '{"file_path":"src/app.ts","old_string":"a","new_string":"b"}', output: "edited" },
      { id: "test", name: "Bash", input: '{"command":"npm test"}', output: "ok" },
    ];
    render(
      <AssistantTimeline
        message={message(tools, {
          timeline: [...tools.map((tool) => ({ type: "tool" as const, id: tool.id })), { type: "activity", id: "sub" }],
          agentActivities: [{ id: "sub", kind: "subagent_activity", activityKind: "started", agentThreadId: "t", agentPath: "root/worker" }],
        })}
      />,
    );
    await user.click(screen.getByRole("button", { name: /4 tools used/ }));
    const line = screen.getByRole("button", { name: /^root\/worker/ });
    expect(within(line).getByText("started")).toBeVisible();
    expect(line).not.toHaveAttribute("aria-expanded");
    expect(line.closest("[hidden]")).toBeNull();
  });

  it("omits the Prompt row without a prompt and the Result row with empty output", async () => {
    const user = userEvent.setup();
    const bare = agentTool({ input: JSON.stringify({ subagent_type: "Explore", description: "Review settings" }), output: "" });
    render(<AssistantTimeline message={message([bare, readChild])} />);
    await user.click(agentLine());
    expect(screen.getByRole("button", { name: /^settings\.ts/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Prompt" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Result" })).not.toBeInTheDocument();
  });

  it("renders structured output as JSON instead of crashing", async () => {
    const user = userEvent.setup();
    const objectOutput = { type: "text", text: "agent result" } as unknown as string;
    render(<AssistantTimeline message={message([agentTool({ output: objectOutput })])} />);
    await user.click(agentLine());
    await user.click(screen.getByRole("button", { name: "Result" }));
    expect(screen.getByText(/"text": "agent result"/)).toBeVisible();
  });
});
