import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/hooks/useProjects", () => ({
  useProjects: () => ({
    projects: [
      {
        id: "proj-1",
        name: "hive",
        url: "https://github.com/acme/hive",
        hasFavicon: false,
        workspaces: [
          { id: "ws-1", name: "denver", branch: "main", status: "idle", createdAt: "2026-01-01" },
          { id: "ws-2", name: "tokyo", branch: "feat/auth", status: "idle", createdAt: "2026-01-01" },
        ],
      },
    ],
  }),
}));

let liveDataRef: Record<string, any> = {};
vi.mock("@/contexts/WorkspaceLiveDataContext", () => ({
  useWorkspaceLiveDataContext: () => liveDataRef,
}));

vi.mock("@/components/ProjectAvatar", () => ({
  ProjectAvatar: ({ name }: { name: string }) => <span data-testid="project-avatar">{name}</span>,
}));

vi.mock("@/components/BranchLabel", () => ({
  BranchLabel: ({ branch }: { branch: string }) => <span data-testid="branch-label">{branch}</span>,
}));

vi.mock("@/components/Sidebar", () => ({
  parseProjectOwnerRepo: (url: string) => {
    const m = url.match(/github\.com\/(.+?)\/(.+?)$/);
    return m ? { owner: m[1], repo: m[2] } : null;
  },
}));

vi.mock("@/components/chat/AgentActivityPreview", () => ({
  default: () => <span data-testid="activity-preview" />,
}));

import { SessionPicker } from "@/components/mosaic/SessionPicker";
import type { SessionTile } from "@/hooks/useAllSessions";

function makeTile(wsId: string, sessionId: string, title?: string, isActive = false): SessionTile {
  return {
    wsId,
    session: {
      sessionId,
      workspaceId: wsId,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      messageCount: 0,
      title,
    },
    isActive,
    tileId: `${wsId}:${sessionId}`,
  };
}

function renderPicker(overrides?: {
  sessions?: SessionTile[];
  selectedIds?: string[];
  atMax?: boolean;
  onToggle?: (id: string) => void;
  liveData?: Record<string, any>;
}) {
  const sessions = overrides?.sessions ?? [
    makeTile("ws-1", "s1", "Auth refactor"),
    makeTile("ws-2", "s2", "Bug fix"),
  ];
  const onToggle = overrides?.onToggle ?? vi.fn();
  liveDataRef = overrides?.liveData ?? {};

  return {
    onToggle,
    ...render(
      <SessionPicker
        open
        onOpenChange={vi.fn()}
        sessions={sessions}
        selectedIds={overrides?.selectedIds ?? ["ws-1:s1"]}
        atMax={overrides?.atMax ?? false}
        onToggle={onToggle}
      >
        <button type="button">Edit</button>
      </SessionPicker>,
    ),
  };
}

describe("SessionPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    liveDataRef = {};
  });

  it("renders sessions grouped by project", () => {
    renderPicker();
    expect(screen.getByText("acme/hive")).toBeInTheDocument();
    expect(screen.getByText("Auth refactor")).toBeInTheDocument();
    expect(screen.getByText("Bug fix")).toBeInTheDocument();
  });

  it("shows workspace sub-headers", () => {
    renderPicker();
    expect(screen.getByText("denver")).toBeInTheDocument();
    expect(screen.getByText("tokyo")).toBeInTheDocument();
  });

  it("shows checked state for selected sessions", () => {
    renderPicker({ selectedIds: ["ws-1:s1"] });
    const checkboxes = screen.getAllByRole("checkbox");
    // First checkbox (ws-1:s1) should be checked
    expect(checkboxes[0]).toHaveAttribute("data-state", "checked");
    // Second checkbox (ws-2:s2) should not be checked
    expect(checkboxes[1]).toHaveAttribute("data-state", "unchecked");
  });

  it("calls onToggle when clicking a session", async () => {
    const user = userEvent.setup();
    const { onToggle } = renderPicker({ selectedIds: [] });

    await user.click(screen.getByText("Auth refactor"));
    expect(onToggle).toHaveBeenCalledWith("ws-1:s1");
  });

  it("disables unselected sessions when at max", () => {
    renderPicker({
      selectedIds: ["ws-1:s1"],
      atMax: true,
    });
    // ws-2:s2 is not selected and atMax=true, so its button should be disabled
    const buttons = screen.getAllByRole("button");
    const bugFixButton = buttons.find((b) => b.textContent?.includes("Bug fix"));
    expect(bugFixButton).toBeDisabled();
  });

  it("wraps disabled sessions in tooltip", () => {
    renderPicker({
      selectedIds: ["ws-1:s1"],
      atMax: true,
    });
    // Disabled buttons are wrapped in a span for tooltip forwarding
    const bugFixButton = screen.getAllByRole("button").find((b) => b.textContent?.includes("Bug fix"));
    // The disabled button should be inside a span (tooltip trigger wrapper)
    expect(bugFixButton?.closest("span")).toBeTruthy();
  });

  it("selected sessions remain enabled when at max", () => {
    renderPicker({
      selectedIds: ["ws-1:s1"],
      atMax: true,
    });
    const buttons = screen.getAllByRole("button");
    const authButton = buttons.find((b) => b.textContent?.includes("Auth refactor"));
    expect(authButton).not.toBeDisabled();
  });

  it("shows streaming indicator for streaming sessions", () => {
    renderPicker({
      liveData: {
        "ws-1": { streamingSessions: { s1: true } },
      },
    });
    expect(screen.getByTestId("activity-preview")).toBeInTheDocument();
  });

  it("shows Active badge for active sessions", () => {
    renderPicker({
      sessions: [makeTile("ws-1", "s1", "Session 1", true)],
    });
    expect(screen.getByText("Active")).toBeInTheDocument();
  });
});
