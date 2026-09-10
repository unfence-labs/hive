import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AssistantTimeline } from "@/components/chat/AssistantTimeline";
import type { AgentActivity, ChatMessage, ReasoningSegment, ToolCall } from "@/types";

vi.mock("@/components/ai-elements/message", () => ({
  MessageResponse: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

const base: ChatMessage = { id: "turn", sessionId: "s", role: "assistant", timestamp: "2026-09-08T10:00:00Z", content: "" };

function activityMessage(activity: AgentActivity): ChatMessage {
  return { ...base, timeline: [{ type: "activity", id: activity.id }], agentActivities: [activity] };
}

function toolMessage(...toolCalls: ToolCall[]): ChatMessage {
  return { ...base, timeline: toolCalls.map((tool) => ({ type: "tool", id: tool.id })), toolCalls };
}

function reasoningMessage(segments: ReasoningSegment[]): ChatMessage {
  return { ...base, timeline: [{ type: "reasoning", id: "r" }], reasoningSegments: segments };
}

const questionTool: ToolCall = {
  id: "ask",
  name: "AskUserQuestion",
  input: JSON.stringify({
    questions: [
      { question: "Choose language", options: [{ label: "TypeScript", description: "Strict by default" }, { label: "JavaScript" }] },
      { question: "Choose runtime", options: [{ label: "Node.js" }] },
    ],
  }),
};

const planWrite: ToolCall = {
  id: "write",
  name: "Write",
  input: JSON.stringify({ file_path: "/repo/.claude/plans/fix.md", content: "## Plan body" }),
  output: "saved",
};
const planTool: ToolCall = { id: "plan", name: "ExitPlanMode", input: "{}" };

const stepButton = (name: string | RegExp) => screen.getByRole("button", { name });
const pill = (button: HTMLElement, text: string) => within(button).getByText(text);

describe("question steps", () => {
  it("reads as awaiting while interactive and opens the read-only questions list", async () => {
    const user = userEvent.setup();
    render(<AssistantTimeline message={toolMessage(questionTool)} isInteractive />);
    const line = stepButton(/^Choose language/);
    expect(pill(line, "awaiting")).toBeVisible();
    expect(line).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("TypeScript")).not.toBeInTheDocument();

    await user.click(line);
    expect(screen.getByText("TypeScript")).toBeVisible();
    expect(screen.getByText(/· Strict by default/)).toBeVisible();
    expect(screen.getByText("Choose runtime")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Submit" })).not.toBeInTheDocument();
  });

  it("shows answered once handled and cancelled when dismissed", () => {
    const { rerender } = render(<AssistantTimeline message={toolMessage(questionTool)} />);
    expect(pill(stepButton(/^Choose language/), "answered")).toBeVisible();

    rerender(<AssistantTimeline message={toolMessage(questionTool)} dismissedToolCallIds={new Set(["ask"])} />);
    expect(pill(stepButton(/^Choose language/), "cancelled")).toBeVisible();
  });

  it("falls back to a User input subject when the payload has no questions", () => {
    render(<AssistantTimeline message={toolMessage({ id: "ask", name: "AskUserQuestion", input: JSON.stringify({ questions: [] }) })} />);
    expect(stepButton(/^User input/)).toBeVisible();
  });
});

describe("plan steps", () => {
  it("starts open while interactive, toggles on click and auto-collapses once approved", async () => {
    const user = userEvent.setup();
    const message = toolMessage(planWrite, planTool);
    const { rerender } = render(<AssistantTimeline message={message} isInteractive />);
    const line = () => stepButton(/^Proposed plan/);
    expect(pill(line(), "awaiting")).toBeVisible();
    expect(screen.getByTestId("markdown")).toHaveTextContent("## Plan body");
    expect(screen.queryByRole("button", { name: /fix\.md/ })).not.toBeInTheDocument();

    await user.click(line());
    expect(screen.getByTestId("markdown")).not.toBeVisible();
    await user.click(line());
    expect(screen.getByTestId("markdown")).toBeVisible();

    rerender(<AssistantTimeline message={message} planStatus="approved" />);
    expect(screen.getByTestId("markdown")).not.toBeVisible();
    expect(pill(line(), "approved")).toBeVisible();

    await user.click(line());
    expect(screen.getByTestId("markdown")).toBeVisible();
  });

  it("starts collapsed with the revised pill and is not expandable without plan content", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<AssistantTimeline message={toolMessage(planWrite, planTool)} planStatus="revised" />);
    expect(pill(stepButton(/^Proposed plan/), "revised")).toBeVisible();
    expect(screen.queryByTestId("markdown")).not.toBeInTheDocument();

    rerender(<AssistantTimeline message={toolMessage(planTool)} isInteractive />);
    expect(stepButton(/^Proposed plan/)).not.toHaveAttribute("aria-expanded");
    await user.click(stepButton(/^Proposed plan/));
    expect(screen.queryByTestId("markdown")).not.toBeInTheDocument();
  });
});

describe("reasoning steps", () => {
  it("falls back to a Reasoning subject and opens the thoughts", async () => {
    const user = userEvent.setup();
    render(<AssistantTimeline message={reasoningMessage([{ id: "r:0", body: "Checking the tests" }])} />);
    const line = stepButton(/^Reasoning/);
    expect(pill(line, "thought")).toBeVisible();
    expect(screen.queryByText("Checking the tests")).not.toBeInTheDocument();
    await user.click(line);
    expect(screen.getByText("Checking the tests")).toBeVisible();
  });

  it("reads as its headline on the live line while streaming, then as a thought line", async () => {
    const user = userEvent.setup();
    const message = reasoningMessage([{ id: "r:0", headline: "Inspecting the repository" }]);
    const { rerender } = render(<AssistantTimeline message={message} streaming />);
    const header = screen.getByTestId("live-line");
    expect(header).toHaveTextContent(/^Current step: Inspecting the repository thinking/);
    expect(within(header).getByText("thinking")).toBeVisible();
    await user.click(header);
    // The header owns the live step; the opened list does not repeat it.
    expect(screen.queryByRole("button", { name: /^Inspecting the repository/ })).not.toBeInTheDocument();
    rerender(<AssistantTimeline message={message} />);
    expect(screen.queryByTestId("live-line")).not.toBeInTheDocument();
    expect(pill(stepButton(/^Inspecting the repository thought/), "thought")).toBeVisible();
  });

  it("joins headline and body on one line and skips empty segments in the panel", async () => {
    const user = userEvent.setup();
    render(<AssistantTimeline message={reasoningMessage([{ id: "r:0" }, { id: "r:1", headline: "Verifying branch", body: "Checking the diff is current" }])} />);
    await user.click(stepButton(/^Verifying branch/));
    const panel = screen.getByText("Checking the diff is current").closest("div")!;
    expect(panel).toHaveTextContent("Verifying branch · Checking the diff is current");
    expect(screen.getAllByText("·", { selector: "[aria-hidden]" })).toHaveLength(1);
  });

  it("is not expandable when the panel would only repeat the headline", () => {
    render(<AssistantTimeline message={reasoningMessage([{ id: "r:0", headline: "Resolving file read conflict" }])} />);
    const line = stepButton(/^Resolving file read conflict/);
    expect(line).not.toHaveAttribute("aria-expanded");
    expect(screen.getAllByText("Resolving file read conflict")).toHaveLength(1);
  });

  it("renders nothing when every segment is empty", () => {
    render(<AssistantTimeline message={reasoningMessage([{ id: "r:0" }, { id: "r:1" }])} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("diagnostic steps", () => {
  const diagnostic = (severity: "info" | "warning" | "error"): AgentActivity => ({
    id: "diag", kind: "diagnostic", severity, title: "Rate limited", message: "Slow down", details: "Retry after 30s",
  });

  it("carries the severity as a trailing mark and opens message and details", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<AssistantTimeline message={activityMessage(diagnostic("warning"))} />);
    expect(within(stepButton(/^Rate limited/)).getByLabelText("Diagnostic warning")).toBeVisible();
    expect(pill(stepButton(/^Rate limited/), "reported")).toBeVisible();

    await user.click(stepButton(/^Rate limited/));
    expect(screen.getByText(/Slow down/)).toBeVisible();
    expect(screen.getByText(/Retry after 30s/)).toBeVisible();

    rerender(<AssistantTimeline message={activityMessage(diagnostic("error"))} />);
    expect(within(stepButton(/^Rate limited/)).getByLabelText("Diagnostic error")).toBeVisible();

    rerender(<AssistantTimeline message={activityMessage(diagnostic("info"))} />);
    expect(screen.queryByLabelText(/^Diagnostic/)).not.toBeInTheDocument();
  });
});

describe("image steps", () => {
  const viewed: AgentActivity = {
    id: "img", kind: "image_view", path: "/repo/assets/screenshot.png", relativePath: "assets/screenshot.png",
    imageUrl: "/api/workspaces/ws-1/file/raw?path=assets%2Fscreenshot.png",
  };

  it("shows the file name on the line and opens the thumbnail lightbox from the panel", async () => {
    const user = userEvent.setup();
    render(<AssistantTimeline message={activityMessage(viewed)} />);
    expect(pill(stepButton(/^screenshot\.png/), "viewed")).toBeVisible();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();

    await user.click(stepButton(/^screenshot\.png/));
    const image = screen.getByRole("img", { name: "screenshot.png" });
    expect(image).toHaveAttribute("src", expect.stringContaining("/api/workspaces/ws-1/file/raw"));
    fireEvent.load(image);
    await user.click(screen.getByRole("button", { name: "Open image" }));
    expect(within(screen.getByRole("dialog")).getByRole("img", { name: "screenshot.png" })).toBeInTheDocument();
  });

  it("explains an outside-workspace image instead of a preview", async () => {
    const user = userEvent.setup();
    render(<AssistantTimeline message={activityMessage({ id: "img", kind: "image_view", path: "/var/elsewhere.png", outsideWorkspace: true })} />);
    await user.click(stepButton(/^elsewhere\.png/));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByTitle("Image is outside the workspace and cannot be previewed.")).toBeInTheDocument();
  });

  it("keeps a generation pending only while the turn is live", async () => {
    const user = userEvent.setup();
    const generation = activityMessage({ id: "gen", kind: "image_generation", status: "inProgress" });
    const { rerender } = render(<AssistantTimeline message={generation} streaming />);
    expect(within(screen.getByTestId("live-line")).getByText("generating")).toBeVisible();

    rerender(<AssistantTimeline message={generation} />);
    expect(pill(stepButton(/^image/), "generated")).toBeVisible();
    await user.click(stepButton(/^image/));
    expect(screen.queryByLabelText("Generating image")).not.toBeInTheDocument();
  });

  it("renders the generated image with its revised prompt", async () => {
    const user = userEvent.setup();
    const prompt = "A hive logo in watercolor";
    render(<AssistantTimeline message={activityMessage({
      id: "gen", kind: "image_generation", status: "completed", revisedPrompt: prompt,
      savedPath: "/repo/generated/logo.png", relativePath: "generated/logo.png",
      imageUrl: "/api/workspaces/ws-1/file/raw?path=generated%2Flogo.png",
    })} />);
    await user.click(stepButton(/^logo\.png/));
    expect(screen.getByRole("img", { name: prompt })).toHaveAttribute("src", expect.stringContaining("/api/workspaces/ws-1/file/raw"));
    expect(screen.getByText(prompt)).toBeVisible();
  });
  it("falls back to an error tile when the thumbnail fails to load", async () => {
    const user = userEvent.setup();
    render(<AssistantTimeline message={activityMessage(viewed)} />);
    await user.click(stepButton(/^screenshot\.png/));
    fireEvent.error(screen.getByRole("img", { name: "screenshot.png" }));
    expect(screen.getByLabelText("Preview unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open image" })).not.toBeInTheDocument();
  });

  it("inlines a base64 result when the generation has no saved file", async () => {
    const user = userEvent.setup();
    render(<AssistantTimeline message={activityMessage({ id: "gen", kind: "image_generation", status: "completed", result: "aGVsbG8=" })} />);
    await user.click(stepButton(/^image/));
    expect(screen.getByRole("img", { name: "Generated image" })).toHaveAttribute("src", "data:image/png;base64,aGVsbG8=");
  });

  it("resolves an already cached image without waiting for onLoad", async () => {
    const user = userEvent.setup();
    const completeSpy = vi.spyOn(window.HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    const widthSpy = vi.spyOn(window.HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(64);
    try {
      render(<AssistantTimeline message={activityMessage({ id: "gen", kind: "image_generation", status: "completed", result: "aGVsbG8=" })} />);
      await user.click(stepButton(/^image/));
      expect(screen.getByRole("button", { name: "Open image" })).toBeInTheDocument();
      expect(screen.queryByLabelText("Generating image")).not.toBeInTheDocument();
    } finally {
      completeSpy.mockRestore();
      widthSpy.mockRestore();
    }
  });
});

describe("compaction steps", () => {
  it("reads Context compacting while live, Context compacted after, and never expands", async () => {
    const user = userEvent.setup();
    const compaction = activityMessage({ id: "compact", kind: "context_compaction", status: "inProgress" });
    const { rerender } = render(<AssistantTimeline message={compaction} streaming />);
    expect(within(screen.getByTestId("live-line")).getByText("compacting")).toBeVisible();
    await user.click(screen.getByTestId("live-line"));
    expect(screen.queryByRole("button", { name: /^Context/ })).not.toBeInTheDocument();

    rerender(<AssistantTimeline message={compaction} />);
    expect(pill(stepButton(/^Context/), "compacted")).toBeVisible();
    expect(stepButton(/^Context/)).not.toHaveAttribute("aria-expanded");
  });
});
