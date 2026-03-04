import { render, screen, waitFor } from "@testing-library/react";
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

function findUnreadDot(container: HTMLElement) {
  return container.querySelector("span[class*='rounded-full'][class*='bg-primary']");
}

describe("ConversationTabs", () => {
  it("renders tab titles from session metadata", () => {
    renderTabs();
    expect(screen.getByText("First conversation")).toBeInTheDocument();
    expect(screen.getByText("Second conversation")).toBeInTheDocument();
  });

  it("falls back to 'Untitled' when no title is set", () => {
    renderTabs({
      sessions: [
        makeSession("sess-1", "2026-02-12T00:00:01.000Z"),
        makeSession("sess-2", "2026-02-12T00:00:00.000Z"),
      ],
    });
    expect(screen.getAllByText("Untitled")).toHaveLength(2);
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

    expect(activeTab.className).toContain("text-foreground");
    expect(activeTab.className).toContain("after:bg-primary");
    expect(inactiveTab.className).toContain("text-muted-foreground");
    expect(inactiveTab.className).not.toContain("after:bg-primary");
  });

  it("renders the + button with 'New conversation' title", () => {
    renderTabs();
    const plusBtn = screen.getByTitle("New conversation");
    expect(plusBtn).toBeInTheDocument();
  });

  it("renders correctly with empty sessions list", () => {
    renderTabs({ sessions: [], activeSessionId: undefined });

    // Empty state still shows an active Untitled tab
    expect(screen.getByText("Untitled")).toBeInTheDocument();
    expect(screen.getByTitle("New conversation")).toBeInTheDocument();
  });

  it("shows streaming indicator on empty Untitled tab when streaming", () => {
    renderTabs({ sessions: [], activeSessionId: undefined, isStreaming: true });

    const untitledTab = screen.getByRole("button", { name: /Untitled/ });
    expect(untitledTab.querySelector("[aria-label='Agent thinking']")).toBeInTheDocument();
  });

  it("dims the empty Untitled tab when file tab is active", () => {
    renderTabs({
      sessions: [],
      activeSessionId: undefined,
      openFile: "src/index.ts",
      isFileTabActive: true,
    });

    const untitledTab = screen.getByText("Untitled").parentElement as HTMLElement;
    expect(untitledTab.className).toContain("text-muted-foreground");
    expect(untitledTab.className).not.toContain("text-accent-foreground");
  });

  it("calls onConversationActivate when clicking empty Untitled tab", async () => {
    const user = userEvent.setup();
    const onConversationActivate = vi.fn();
    renderTabs({
      sessions: [],
      activeSessionId: undefined,
      openFile: "src/index.ts",
      isFileTabActive: true,
      onConversationActivate,
    });

    await user.click(screen.getByRole("button", { name: "Untitled" }));
    expect(onConversationActivate).toHaveBeenCalledTimes(1);
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

  it("hides X button on active tab while streaming", () => {
    const { onDeleteSession } = renderTabs({ isStreaming: true });

    // Active streaming tab should not render a close action.
    const activeTab = screen.getByText("First conversation").closest("button")!;
    const activeX = activeTab.querySelector("[role='button']");
    expect(activeX).toBeNull();

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

  it("shows orbit loader on active tab when streaming", () => {
    renderTabs({ isStreaming: true });
    const activeTab = screen.getByText("First conversation").closest("button")!;
    const orbitSvg = activeTab.querySelector("[aria-label='Agent thinking']");
    expect(orbitSvg).toBeInTheDocument();
  });

  it("shows MessageSquare icon on inactive tab even when streaming", () => {
    renderTabs({ isStreaming: true });
    const inactiveTab = screen.getByText("Second conversation").closest("button")!;
    const orbitSvg = inactiveTab.querySelector("[aria-label='Agent thinking']");
    expect(orbitSvg).not.toBeInTheDocument();
    // Should still have the MessageSquare icon
    expect(inactiveTab.querySelector("svg")).toBeInTheDocument();
  });

  it("shows unread dot for inactive unread session when not streaming", () => {
    renderTabs({
      unreadSessions: { "sess-2": true },
    });

    const inactiveTab = screen.getByText("Second conversation").closest("button")!;
    expect(findUnreadDot(inactiveTab)).toBeInTheDocument();
    expect(inactiveTab.querySelector("svg.lucide-message-square")).toBeNull();
  });

  it("does not show unread dot for active session even when unreadSessions marks it", () => {
    renderTabs({
      unreadSessions: { "sess-1": true },
    });

    const activeTab = screen.getByText("First conversation").closest("button")!;
    expect(findUnreadDot(activeTab)).not.toBeInTheDocument();
  });

  it("shows unread dot for active session when file tab is active", () => {
    renderTabs({
      unreadSessions: { "sess-1": true },
      openFile: "src/index.ts",
      isFileTabActive: true,
    });

    const activeButHiddenConversationTab = screen.getByText("First conversation").closest("button")!;
    expect(findUnreadDot(activeButHiddenConversationTab)).toBeInTheDocument();
  });

  it("prioritizes streaming indicator over unread dot", () => {
    renderTabs({
      unreadSessions: { "sess-2": true },
      streamingSessions: { "sess-2": true },
    });

    const inactiveTab = screen.getByText("Second conversation").closest("button")!;
    expect(inactiveTab.querySelector("[aria-label='Agent thinking']")).toBeInTheDocument();
    expect(findUnreadDot(inactiveTab)).not.toBeInTheDocument();
  });

  it("shows MessageSquare icon on active tab when not streaming", () => {
    renderTabs({ isStreaming: false });
    const activeTab = screen.getByText("First conversation").closest("button")!;
    const orbitSvg = activeTab.querySelector("[aria-label='Agent thinking']");
    expect(orbitSvg).not.toBeInTheDocument();
    expect(activeTab.querySelector("svg")).toBeInTheDocument();
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
    expect(screen.getByText("Untitled")).toBeInTheDocument();
  });

  it("shows unread dot in overflow menu for unread overflow sessions", async () => {
    const user = userEvent.setup();
    const clientWidthSpy = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(50);
    const scrollWidthSpy = vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(50);

    try {
      renderTabs({
        sessions: [
          makeSession("s1", "2026-02-12T00:00:03.000Z", "Alpha"),
          makeSession("s2", "2026-02-12T00:00:02.000Z", "Beta"),
          makeSession("s3", "2026-02-12T00:00:01.000Z", "Gamma"),
        ],
        activeSessionId: "s1",
        unreadSessions: { s3: true },
      });

      const overflowTrigger = await waitFor(() => {
        const trigger = (
          document.querySelector("svg.lucide-more-horizontal")?.closest("button")
          ?? document.querySelector("svg.lucide-ellipsis")?.closest("button")
        ) as HTMLButtonElement | null;
        expect(trigger).toBeTruthy();
        return trigger as HTMLButtonElement;
      });

      await user.click(overflowTrigger);
      const overflowItem = await screen.findByRole("menuitem", { name: /Gamma/i });
      expect(findUnreadDot(overflowItem)).toBeInTheDocument();
    } finally {
      clientWidthSpy.mockRestore();
      scrollWidthSpy.mockRestore();
    }
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

  it("applies active styling to file tab when file tab is active", () => {
    renderTabs({ openFile: "src/index.ts", isFileTabActive: true });
    const fileTab = screen.getByText("index.ts").closest("button")!;
    expect(fileTab.className).toContain("text-foreground");
    expect(fileTab.className).toContain("after:bg-primary");
  });

  it("applies inactive styling to file tab when file tab is inactive", () => {
    renderTabs({ openFile: "src/index.ts", isFileTabActive: false });
    const fileTab = screen.getByText("index.ts").closest("button")!;
    expect(fileTab.className).toContain("text-muted-foreground");
    expect(fileTab.className).not.toContain("text-accent-foreground");
  });

  it("dims conversation tab styling when file tab is active", () => {
    renderTabs({ openFile: "src/index.ts", isFileTabActive: true });
    const convTab = screen.getByText("First conversation").closest("button")!;
    expect(convTab.className).toContain("text-muted-foreground");
    expect(convTab.className).not.toContain("text-accent-foreground");
  });

  it("calls onFileTabActivate callback when clicking the file tab", async () => {
    const user = userEvent.setup();
    const onFileTabActivate = vi.fn();
    renderTabs({ openFile: "README.md", isFileTabActive: false, onFileTabActivate });

    await user.click(screen.getByText("README.md"));

    expect(onFileTabActivate).toHaveBeenCalledTimes(1);
  });

  it("calls onFileTabClose when clicking X on the file tab", async () => {
    const user = userEvent.setup();
    const onFileTabClose = vi.fn();
    renderTabs({ openFile: "README.md", isFileTabActive: true, onFileTabClose });

    const fileTab = screen.getByText("README.md").closest("button")!;
    await user.hover(fileTab);
    const closeBtn = fileTab.querySelector("[role='button']") as HTMLElement;
    await user.click(closeBtn);

    expect(onFileTabClose).toHaveBeenCalledTimes(1);
  });

  it("renders file tab to the left of conversation tabs", () => {
    renderTabs({ openFile: "src/app.ts", isFileTabActive: true });
    const fileTab = screen.getByText("app.ts").closest("button")!;
    const convTab = screen.getByText("First conversation").closest("button")!;

    // file tab should appear before conversation tab in DOM order
    expect(
      fileTab.compareDocumentPosition(convTab) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders a File icon in the file tab when in source mode", () => {
    renderTabs({ openFile: "package.json", fileViewMode: "source" });
    const fileTab = screen.getByText("package.json").closest("button")!;
    expect(fileTab.querySelector("svg.lucide-file")).toBeInTheDocument();
    expect(fileTab.querySelector("svg.lucide-git-compare-arrows")).toBeNull();
  });

  it("renders a diff icon in the file tab when in diff mode", () => {
    renderTabs({ openFile: "package.json", fileViewMode: "diff" });
    const fileTab = screen.getByText("package.json").closest("button")!;
    expect(fileTab.querySelector("svg.lucide-git-compare-arrows")).toBeInTheDocument();
    expect(fileTab.querySelector("svg.lucide-file")).toBeNull();
  });

  it("keeps all conversation tabs reachable via overflow when file tab consumes visible width", async () => {
    const user = userEvent.setup();
    const clientWidthSpy = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(50);
    const scrollWidthSpy = vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(50);

    try {
      renderTabs({ openFile: "src/app.ts", isFileTabActive: true });

      const overflowTrigger = await waitFor(() => {
        const trigger = (
          document.querySelector("svg.lucide-more-horizontal")?.closest("button")
          ?? document.querySelector("svg.lucide-ellipsis")?.closest("button")
        ) as HTMLButtonElement | null;
        expect(trigger).toBeTruthy();
        return trigger as HTMLButtonElement;
      });

      await user.click(overflowTrigger);
      expect(await screen.findByRole("menuitem", { name: /First conversation/i })).toBeInTheDocument();
      expect(await screen.findByRole("menuitem", { name: /Second conversation/i })).toBeInTheDocument();
    } finally {
      clientWidthSpy.mockRestore();
      scrollWidthSpy.mockRestore();
    }
  });
});
