import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ChatMessage from "@/components/ChatMessage";
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
    render(<ChatMessage message={toolMessage(questionTool)} isInteractive />);
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
    const { rerender } = render(<ChatMessage message={toolMessage(questionTool)} />);
    expect(pill(stepButton(/^Choose language/), "answered")).toBeVisible();

    rerender(<ChatMessage message={toolMessage(questionTool)} dismissedToolCallIds={new Set(["ask"])} />);
    expect(pill(stepButton(/^Choose language/), "cancelled")).toBeVisible();
  });

  it("falls back to a User input subject when the payload has no questions", () => {
    render(<ChatMessage message={toolMessage({ id: "ask", name: "AskUserQuestion", input: JSON.stringify({ questions: [] }) })} />);
    expect(stepButton(/^User input/)).toBeVisible();
  });
});

describe("plan steps", () => {
  it("starts open while interactive, toggles on click and auto-collapses once approved", async () => {
    const user = userEvent.setup();
    const message = toolMessage(planWrite, planTool);
    const { rerender } = render(<ChatMessage message={message} isInteractive />);
    const line = () => stepButton(/^Proposed plan/);
    expect(pill(line(), "awaiting")).toBeVisible();
    expect(screen.getByTestId("markdown")).toHaveTextContent("## Plan body");
    expect(screen.queryByRole("button", { name: /fix\.md/ })).not.toBeInTheDocument();

    await user.click(line());
    expect(screen.getByTestId("markdown")).not.toBeVisible();
    await user.click(line());
    expect(screen.getByTestId("markdown")).toBeVisible();

    rerender(<ChatMessage message={message} planStatus="approved" />);
    expect(screen.getByTestId("markdown")).not.toBeVisible();
    expect(pill(line(), "approved")).toBeVisible();

    await user.click(line());
    expect(screen.getByTestId("markdown")).toBeVisible();
  });

  it("starts collapsed with the revised pill and is not focusable without plan content", () => {
    const { rerender } = render(<ChatMessage message={toolMessage(planWrite, planTool)} planStatus="revised" />);
    expect(pill(stepButton(/^Proposed plan/), "revised")).toBeVisible();
    expect(screen.queryByTestId("markdown")).not.toBeInTheDocument();

    rerender(<ChatMessage message={toolMessage(planTool)} isInteractive />);
    expect(screen.getByText("Proposed plan")).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Proposed plan/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId("markdown")).not.toBeInTheDocument();
  });
});

describe("reasoning steps", () => {
  it("falls back to a Reasoning subject and opens the thoughts", async () => {
    const user = userEvent.setup();
    render(<ChatMessage message={reasoningMessage([{ id: "r:0", body: "Checking the tests" }])} />);
    const line = stepButton(/^Reasoning/);
    expect(pill(line, "thought")).toBeVisible();
    expect(screen.queryByText("Checking the tests")).not.toBeInTheDocument();
    await user.click(line);
    expect(screen.getByText("Checking the tests")).toBeVisible();
  });

  it("reads as its headline on the live line while streaming, then as a thought line", async () => {
    const user = userEvent.setup();
    const message = reasoningMessage([{ id: "r:0", headline: "Inspecting the repository" }]);
    const { rerender } = render(<ChatMessage message={message} streaming />);
    const header = screen.getByTestId("live-line");
    expect(header).toHaveTextContent(/^Current step: Inspecting the repository thinking/);
    expect(within(header).getByText("thinking")).toBeVisible();
    await user.click(header);
    // The header owns the live step; the opened list does not repeat it.
    expect(screen.queryByRole("button", { name: /^Inspecting the repository/ })).not.toBeInTheDocument();
    rerender(<ChatMessage message={message} />);
    expect(screen.queryByTestId("live-line")).not.toBeInTheDocument();
    expect(pill(screen.getByText("Inspecting the repository").parentElement!, "thought")).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Inspecting the repository/ })).not.toBeInTheDocument();
  });

  it("joins headline and body on one line and skips empty segments in the panel", async () => {
    const user = userEvent.setup();
    render(<ChatMessage message={reasoningMessage([{ id: "r:0" }, { id: "r:1", headline: "Verifying branch", body: "Checking the diff is current" }])} />);
    await user.click(stepButton(/^Verifying branch/));
    const panel = screen.getByText("Checking the diff is current").closest("div")!;
    expect(panel).toHaveTextContent("Verifying branch · Checking the diff is current");
    expect(screen.getAllByText("·", { selector: "[aria-hidden]" })).toHaveLength(1);
  });

  it("is not expandable when the panel would only repeat the headline", () => {
    render(<ChatMessage message={reasoningMessage([{ id: "r:0", headline: "Resolving file read conflict" }])} />);
    expect(screen.queryByRole("button", { name: /^Resolving file read conflict/ })).not.toBeInTheDocument();
    expect(screen.getByText("Resolving file read conflict").closest("[tabindex]")).toBeNull();
    expect(screen.getAllByText("Resolving file read conflict")).toHaveLength(1);
  });

  it("renders nothing when every segment is empty", () => {
    render(<ChatMessage message={reasoningMessage([{ id: "r:0" }, { id: "r:1" }])} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("diagnostic steps", () => {
  const diagnostic = (severity: "info" | "warning" | "error"): AgentActivity => ({
    id: "diag", kind: "diagnostic", severity, title: "Rate limited", message: "Slow down", details: "Retry after 30s",
  });

  it("carries the severity as a trailing mark and opens message and details", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ChatMessage message={activityMessage(diagnostic("warning"))} />);
    expect(within(stepButton(/^Rate limited/)).getByLabelText("Diagnostic warning")).toBeVisible();
    expect(pill(stepButton(/^Rate limited/), "reported")).toBeVisible();

    await user.click(stepButton(/^Rate limited/));
    expect(screen.getByText(/Slow down/)).toBeVisible();
    expect(screen.getByText(/Retry after 30s/)).toBeVisible();

    rerender(<ChatMessage message={activityMessage(diagnostic("error"))} />);
    expect(within(stepButton(/^Rate limited/)).getByLabelText("Diagnostic error")).toBeVisible();

    rerender(<ChatMessage message={activityMessage(diagnostic("info"))} />);
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
    render(<ChatMessage message={activityMessage(viewed)} />);
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
    render(<ChatMessage message={activityMessage({ id: "img", kind: "image_view", path: "/var/elsewhere.png", outsideWorkspace: true })} />);
    await user.click(stepButton(/^elsewhere\.png/));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByTitle("Image is outside the workspace and cannot be previewed.")).toBeInTheDocument();
  });

  it("keeps a generation pending only while the turn is live", async () => {
    const user = userEvent.setup();
    const generation = activityMessage({ id: "gen", kind: "image_generation", status: "inProgress" });
    const { rerender } = render(<ChatMessage message={generation} streaming />);
    expect(within(screen.getByTestId("live-line")).getByText("generating")).toBeVisible();

    rerender(<ChatMessage message={generation} />);
    expect(pill(stepButton(/^image/), "generated")).toBeVisible();
    await user.click(stepButton(/^image/));
    expect(screen.queryByLabelText("Generating image")).not.toBeInTheDocument();
  });

  it("renders the generated image with its revised prompt", async () => {
    const user = userEvent.setup();
    const prompt = "A hive logo in watercolor";
    render(<ChatMessage message={activityMessage({
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
    render(<ChatMessage message={activityMessage(viewed)} />);
    await user.click(stepButton(/^screenshot\.png/));
    fireEvent.error(screen.getByRole("img", { name: "screenshot.png" }));
    expect(screen.getByLabelText("Preview unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open image" })).not.toBeInTheDocument();
  });

  it("inlines a base64 result when the generation has no saved file", async () => {
    const user = userEvent.setup();
    render(<ChatMessage message={activityMessage({ id: "gen", kind: "image_generation", status: "completed", result: "aGVsbG8=" })} />);
    await user.click(stepButton(/^image/));
    expect(screen.getByRole("img", { name: "Generated image" })).toHaveAttribute("src", "data:image/png;base64,aGVsbG8=");
  });

  it("resolves an already cached image without waiting for onLoad", async () => {
    const user = userEvent.setup();
    const completeSpy = vi.spyOn(window.HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    const widthSpy = vi.spyOn(window.HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(64);
    try {
      render(<ChatMessage message={activityMessage({ id: "gen", kind: "image_generation", status: "completed", result: "aGVsbG8=" })} />);
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
    const { rerender } = render(<ChatMessage message={compaction} streaming />);
    expect(within(screen.getByTestId("live-line")).getByText("compacting")).toBeVisible();
    await user.click(screen.getByTestId("live-line"));
    expect(screen.queryByRole("button", { name: /^Context/ })).not.toBeInTheDocument();

    rerender(<ChatMessage message={compaction} />);
    expect(pill(screen.getByText("Context").parentElement!, "compacted")).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Context/ })).not.toBeInTheDocument();
  });
});
