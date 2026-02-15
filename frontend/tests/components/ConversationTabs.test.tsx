import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { ConversationTabs } from "@/components/ConversationTabs";
import type { SessionMetadata } from "@/types";

function makeSession(id: string, updatedAt: string, title?: string): SessionMetadata {
  return {
    sessionId: id,
    workspaceId: "ws-1",
    title,
    createdAt: "2026-02-12T00:00:00.000Z",
    updatedAt,
    messageCount: 1,
  };
}

function renderTabs(props?: Partial<ComponentProps<typeof ConversationTabs>>) {
  const onCreateSession = vi.fn();
  const onActivateSession = vi.fn();
  const onDeleteSession = vi.fn();

  render(
    <ConversationTabs
      sessions={[
        makeSession("sess-1", "2026-02-12T00:00:01.000Z", "First conversation"),
        makeSession("sess-2", "2026-02-12T00:00:00.000Z", "Second conversation"),
      ]}
      activeSessionId="sess-1"
      isStreaming={false}
      onCreateSession={onCreateSession}
      onActivateSession={onActivateSession}
      onDeleteSession={onDeleteSession}
      {...props}
    />,
  );

  return { onCreateSession, onActivateSession, onDeleteSession };
}

describe("ConversationTabs", () => {
  it("renders tab titles from session metadata", () => {
    renderTabs();
    expect(screen.getByText("First conversation")).toBeInTheDocument();
    expect(screen.getByText("Second conversation")).toBeInTheDocument();
  });

  it("falls back to 'Conversation N' when no title is set", () => {
    renderTabs({
      sessions: [
        makeSession("sess-1", "2026-02-12T00:00:01.000Z"),
        makeSession("sess-2", "2026-02-12T00:00:00.000Z"),
      ],
    });
    expect(screen.getByText("Conversation 2")).toBeInTheDocument();
    expect(screen.getByText("Conversation 1")).toBeInTheDocument();
  });

  it("creates a new conversation via the + button", async () => {
    const user = userEvent.setup();
    const { onCreateSession } = renderTabs();

    await user.click(screen.getByTitle("New conversation"));

    expect(onCreateSession).toHaveBeenCalledTimes(1);
  });

  it("activates a non-active tab on click", async () => {
    const user = userEvent.setup();
    const { onActivateSession } = renderTabs();

    await user.click(screen.getByText("Second conversation"));

    expect(onActivateSession).toHaveBeenCalledWith("sess-2");
  });

  it("calls onActivateSession even when clicking the already active tab (supports switching from file view)", async () => {
    const user = userEvent.setup();
    const { onActivateSession } = renderTabs();

    await user.click(screen.getByText("First conversation"));

    expect(onActivateSession).toHaveBeenCalledWith("sess-1");
  });

  it("shows delete confirmation and deletes on confirm", async () => {
    const user = userEvent.setup();
    const { onDeleteSession } = renderTabs();

    // Hover over the inactive tab and click X
    const tab = screen.getByText("Second conversation").closest("button")!;
    await user.hover(tab);
    const closeButtons = tab.querySelectorAll("[role='button']");
    await user.click(closeButtons[0]);

    expect(screen.getByText("Delete conversation")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDeleteSession).toHaveBeenCalledWith("sess-2");
  });

  it("cancelling delete does not call onDeleteSession", async () => {
    const user = userEvent.setup();
    const { onDeleteSession } = renderTabs();

    const tab = screen.getByText("Second conversation").closest("button")!;
    await user.hover(tab);
    const closeButtons = tab.querySelectorAll("[role='button']");
    await user.click(closeButtons[0]);

    expect(screen.getByText("Delete conversation")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDeleteSession).not.toHaveBeenCalled();
  });

  it("hides X buttons when only one conversation exists", () => {
    renderTabs({
      sessions: [makeSession("sess-only", "2026-02-12T00:00:01.000Z", "Only one")],
      activeSessionId: "sess-only",
    });

    const tab = screen.getByText("Only one").closest("button")!;
    expect(tab.querySelector("[role='button']")).not.toBeInTheDocument();
  });

  it("applies active styling to the active tab", () => {
    renderTabs();
    const activeTab = screen.getByText("First conversation").closest("button")!;
    const inactiveTab = screen.getByText("Second conversation").closest("button")!;

    expect(activeTab.className).toContain("bg-accent ");
    expect(activeTab.className).toContain("text-accent-foreground");
    expect(inactiveTab.className).toContain("text-muted-foreground");
    expect(inactiveTab.className).not.toContain("text-accent-foreground");
  });

  it("renders the + button with 'New conversation' title", () => {
    renderTabs();
    const plusBtn = screen.getByTitle("New conversation");
    expect(plusBtn).toBeInTheDocument();
  });

  it("renders correctly with empty sessions list", () => {
    renderTabs({ sessions: [], activeSessionId: undefined });

    // Only the + button should exist, no conversation tabs
    expect(screen.getByTitle("New conversation")).toBeInTheDocument();
    // No tab text should be rendered (no session title or fallback)
    expect(screen.queryByText(/^Conversation \d+$/)).not.toBeInTheDocument();
  });

  it("renders three or more tabs", () => {
    renderTabs({
      sessions: [
        makeSession("s1", "2026-02-12T00:00:03.000Z", "Alpha"),
        makeSession("s2", "2026-02-12T00:00:02.000Z", "Beta"),
        makeSession("s3", "2026-02-12T00:00:01.000Z", "Gamma"),
      ],
      activeSessionId: "s2",
    });

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Gamma")).toBeInTheDocument();
  });

  it("disables X button on active tab while streaming", async () => {
    const user = userEvent.setup();
    const { onDeleteSession } = renderTabs({ isStreaming: true });

    // Active tab X should have pointer-events-none
    const activeTab = screen.getByText("First conversation").closest("button")!;
    const activeX = activeTab.querySelector("[role='button']") as HTMLElement;
    expect(activeX.className).toContain("pointer-events-none");

    // Clicking should not trigger delete dialog
    await user.click(activeX);
    expect(screen.queryByText("Delete conversation")).not.toBeInTheDocument();
    expect(onDeleteSession).not.toHaveBeenCalled();
  });

  it("allows deleting inactive tab while streaming", async () => {
    const user = userEvent.setup();
    const { onDeleteSession } = renderTabs({ isStreaming: true });

    // Inactive tab X should be clickable (no inline pointer-events-none, only disabled: variant)
    const inactiveTab = screen.getByText("Second conversation").closest("button")!;
    await user.hover(inactiveTab);
    const inactiveX = inactiveTab.querySelector("[role='button']") as HTMLElement;
    await user.click(inactiveX);

    // Delete dialog should open for inactive tab even while streaming
    expect(screen.getByText("Delete conversation")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDeleteSession).toHaveBeenCalledWith("sess-2");
  });

  it("shows delete dialog with 'conversation' wording, not 'session'", async () => {
    const user = userEvent.setup();
    renderTabs();

    const tab = screen.getByText("Second conversation").closest("button")!;
    await user.hover(tab);
    const closeButtons = tab.querySelectorAll("[role='button']");
    await user.click(closeButtons[0]);

    expect(screen.getByText("Delete conversation")).toBeInTheDocument();
    expect(screen.getByText(/permanently remove all messages from this conversation/i)).toBeInTheDocument();
    expect(screen.queryByText(/session/i)).not.toBeInTheDocument();
  });

  it("renders a MessageSquare icon in each tab", () => {
    renderTabs({
      sessions: [makeSession("s1", "2026-02-12T00:00:01.000Z", "My Tab")],
      activeSessionId: "s1",
    });

    const tab = screen.getByText("My Tab").closest("button")!;
    const svg = tab.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("mixes titled and untitled sessions correctly", () => {
    renderTabs({
      sessions: [
        makeSession("s1", "2026-02-12T00:00:02.000Z", "Named one"),
        makeSession("s2", "2026-02-12T00:00:01.000Z"),
      ],
      activeSessionId: "s1",
    });

    expect(screen.getByText("Named one")).toBeInTheDocument();
    expect(screen.getByText("Conversation 1")).toBeInTheDocument();
  });
});

describe("ConversationTabs — file tab", () => {
  it("does not render file tab when openFile is null", () => {
    renderTabs({ openFile: null });
    expect(screen.queryByText(/\..*$/)).not.toBeInTheDocument();
  });

  it("renders file tab with filename when openFile is set", () => {
    renderTabs({ openFile: "src/components/App.tsx" });
    expect(screen.getByText("App.tsx")).toBeInTheDocument();
  });

  it("applies active styling to file tab when isFileActive is true", () => {
    renderTabs({ openFile: "src/index.ts", isFileActive: true });
    const fileTab = screen.getByText("index.ts").closest("button")!;
    expect(fileTab.className).toContain("bg-accent");
    expect(fileTab.className).toContain("text-accent-foreground");
  });

  it("applies inactive styling to file tab when isFileActive is false", () => {
    renderTabs({ openFile: "src/index.ts", isFileActive: false });
    const fileTab = screen.getByText("index.ts").closest("button")!;
    expect(fileTab.className).toContain("text-muted-foreground");
    expect(fileTab.className).not.toContain("text-accent-foreground");
  });

  it("dims conversation tab styling when file tab is active", () => {
    renderTabs({ openFile: "src/index.ts", isFileActive: true });
    const convTab = screen.getByText("First conversation").closest("button")!;
    expect(convTab.className).toContain("text-muted-foreground");
    expect(convTab.className).not.toContain("text-accent-foreground");
  });

  it("calls onFileTabClick when clicking the file tab", async () => {
    const user = userEvent.setup();
    const onFileTabClick = vi.fn();
    renderTabs({ openFile: "README.md", isFileActive: false, onFileTabClick });

    await user.click(screen.getByText("README.md"));

    expect(onFileTabClick).toHaveBeenCalledTimes(1);
  });

  it("calls onFileTabClose when clicking X on the file tab", async () => {
    const user = userEvent.setup();
    const onFileTabClose = vi.fn();
    renderTabs({ openFile: "README.md", isFileActive: true, onFileTabClose });

    const fileTab = screen.getByText("README.md").closest("button")!;
    await user.hover(fileTab);
    const closeBtn = fileTab.querySelector("[role='button']") as HTMLElement;
    await user.click(closeBtn);

    expect(onFileTabClose).toHaveBeenCalledTimes(1);
  });

  it("renders file tab to the left of conversation tabs", () => {
    renderTabs({ openFile: "src/app.ts", isFileActive: true });
    const fileTab = screen.getByText("app.ts").closest("button")!;
    const convTab = screen.getByText("First conversation").closest("button")!;

    // file tab should appear before conversation tab in DOM order
    expect(
      fileTab.compareDocumentPosition(convTab) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders a File icon in the file tab", () => {
    renderTabs({ openFile: "package.json" });
    const fileTab = screen.getByText("package.json").closest("button")!;
    const svg = fileTab.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });
});
