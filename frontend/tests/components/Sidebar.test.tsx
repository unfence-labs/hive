import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import Sidebar from "@/components/Sidebar";
import { TerminalProvider, useTerminalContext } from "@/contexts/TerminalContext";
import { api } from "@/hooks/useApi";
import type { Project, WsOutgoing } from "@/types";

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@/lib/ws-transport", () => {
  const messageHandlers = new Map<string, Set<(msg: WsOutgoing) => void>>();

  const getSet = (workspaceId: string) => {
    const existing = messageHandlers.get(workspaceId);
    if (existing) return existing;
    const created = new Set<(msg: WsOutgoing) => void>();
    messageHandlers.set(workspaceId, created);
    return created;
  };

  const wsTransport = {
    onMessage: vi.fn((workspaceId: string, handler: (msg: WsOutgoing) => void) => {
      getSet(workspaceId).add(handler);
      return {
        unsubscribe: () => { getSet(workspaceId).delete(handler); },
        hadBufferedMessages: false,
      };
    }),
  };

  const __wsMock = {
    emit: (workspaceId: string, msg: WsOutgoing) => {
      for (const handler of messageHandlers.get(workspaceId) ?? []) handler(msg);
    },
    reset: () => {
      messageHandlers.clear();
      wsTransport.onMessage.mockClear();
    },
  };

  return { wsTransport, __wsMock };
});

const getWsMock = async () =>
  (await import("@/lib/ws-transport")) as unknown as {
    __wsMock: {
      emit: (workspaceId: string, msg: WsOutgoing) => void;
      reset: () => void;
    };
  };

function ActivateTerminals({ workspaceIds }: { workspaceIds: string[] }) {
  const { openTerminal } = useTerminalContext();
  useEffect(() => {
    for (const workspaceId of workspaceIds) openTerminal(workspaceId);
  }, [workspaceIds, openTerminal]);
  return null;
}

function SettingsStateProbe() {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "none";
  return <div data-testid="settings-from">{from}</div>;
}

function renderSidebar(
  path: string,
  projects: Project[],
  onAddWorkspace = vi.fn(),
  activeTerminalWorkspaceIds: string[] = [],
  onArchiveWorkspace = vi.fn(),
) {
  return render(
    <TerminalProvider>
      <ActivateTerminals workspaceIds={activeTerminalWorkspaceIds} />
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/projects"
            element={
              <Sidebar
                projects={projects}
                loading={false}
                onAddProject={vi.fn()}
                onAddWorkspace={onAddWorkspace}
                onArchiveWorkspace={onArchiveWorkspace}
              />
            }
          />
          <Route
            path="/workspaces/:wsId"
            element={
              <Sidebar
                projects={projects}
                loading={false}
                onAddProject={vi.fn()}
                onAddWorkspace={onAddWorkspace}
                onArchiveWorkspace={onArchiveWorkspace}
              />
            }
          />
          <Route path="/settings" element={<SettingsStateProbe />} />
        </Routes>
      </MemoryRouter>
    </TerminalProvider>,
  );
}

describe("Sidebar", () => {
  const projects: Project[] = [
    {
      id: "p1",
      name: "Alpha",
      url: "https://github.com/acme/alpha.git",
      createdAt: "2026-02-11T00:00:00.000Z",
      workspaces: [
        {
          id: "w1",
          name: "tokyo",
          branch: "workspace/tokyo",
          status: "busy",
          createdAt: "2026-02-11T00:00:00.000Z",
        },
      ],
    },
    {
      id: "p2",
      name: "Beta",
      url: "https://github.com/acme/beta.git",
      createdAt: "2026-02-11T00:00:00.000Z",
      workspaces: [],
    },
  ];

  beforeEach(async () => {
    const { __wsMock } = await getWsMock();
    __wsMock.reset();
  });

  it("renders projects and toggles workspace links from collapsible", async () => {
    const user = userEvent.setup();
    renderSidebar("/projects", projects);

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.queryByText("workspace/tokyo")).not.toBeInTheDocument();

    await user.click(screen.getByText("Alpha"));
    expect(screen.getByText("workspace/tokyo")).toBeInTheDocument();
  });

  it("shows workspace count beside project name only when count is greater than zero", () => {
    renderSidebar("/projects", projects);

    const alphaLabel = screen.getByText("Alpha").closest("span");
    const betaLabel = screen.getByText("Beta").closest("span");

    expect(alphaLabel).toBeInTheDocument();
    expect(alphaLabel?.querySelector("span")).toHaveTextContent("1");
    expect(betaLabel).toBeInTheDocument();
    expect(betaLabel?.querySelector("span")).toBeNull();
  });

  it("expands the active project's workspaces on workspace route", () => {
    renderSidebar("/workspaces/w1", projects);

    expect(screen.getByText("workspace/tokyo")).toBeInTheDocument();
  });

  it("calls add workspace callback", async () => {
    const user = userEvent.setup();
    const onAddWorkspace = vi.fn().mockResolvedValue(undefined);
    renderSidebar("/projects", projects, onAddWorkspace);

    await user.click(screen.getByRole("button", { name: "Add workspace to Alpha" }));

    await waitFor(() => {
      expect(onAddWorkspace).toHaveBeenCalledWith("p1");
    });
  });

  it("shows orbit loader on streaming workspace and hides it when idle", async () => {
    const { __wsMock } = await getWsMock();
    renderSidebar("/workspaces/w1", projects);

    expect(screen.queryByRole("img", { name: "Agent thinking" })).not.toBeInTheDocument();
    expect(screen.getByText("tokyo")).toBeInTheDocument();

    act(() => {
      __wsMock.emit("w1", { type: "status", status: "busy", streaming: true });
    });

    expect(screen.getByRole("img", { name: "Agent thinking" })).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();

    act(() => {
      __wsMock.emit("w1", { type: "status", status: "busy", streaming: false });
    });

    expect(screen.queryByRole("img", { name: "Agent thinking" })).not.toBeInTheDocument();
    expect(screen.getByText("tokyo")).toBeInTheDocument();
  });

  it("hides GitBranch icon when streaming and restores it when idle", async () => {
    const { __wsMock } = await getWsMock();
    renderSidebar("/workspaces/w1", projects);

    // Before streaming: BranchLabel renders its GitBranch SVG icon
    const workspaceLink = screen.getByRole("link", { name: /workspace\/tokyo/i });
    const svgsBefore = workspaceLink.querySelectorAll("svg");
    expect(svgsBefore.length).toBe(1);
    // The single SVG is the GitBranch icon (class includes "lucide")
    expect(svgsBefore[0].classList.toString()).toContain("lucide");

    act(() => {
      __wsMock.emit("w1", { type: "status", status: "busy", streaming: true });
    });

    // While streaming: orbit loader SVG replaces the GitBranch icon
    const svgsStreaming = workspaceLink.querySelectorAll("svg");
    const orbitSvg = Array.from(svgsStreaming).find(
      (svg) => svg.getAttribute("aria-label") === "Agent thinking",
    );
    expect(orbitSvg).toBeTruthy();
    // GitBranch icon should be gone (showIcon=false on BranchLabel)
    const lucideSvg = Array.from(svgsStreaming).find((svg) =>
      svg.classList.toString().includes("lucide-git-branch"),
    );
    expect(lucideSvg).toBeFalsy();

    act(() => {
      __wsMock.emit("w1", { type: "status", status: "busy", streaming: false });
    });

    // After streaming stops: back to GitBranch, no orbit loader
    expect(screen.queryByRole("img", { name: "Agent thinking" })).not.toBeInTheDocument();
    const svgsAfter = workspaceLink.querySelectorAll("svg");
    expect(svgsAfter.length).toBe(1);
    expect(svgsAfter[0].classList.toString()).toContain("lucide");
  });

  it("does not show orbit loader on non-streaming workspaces", async () => {
    const multiWsProjects: Project[] = [
      {
        id: "p1",
        name: "Alpha",
        url: "https://github.com/acme/alpha.git",
        createdAt: "2026-02-11T00:00:00.000Z",
        workspaces: [
          { id: "w1", name: "tokyo", branch: "workspace/tokyo", status: "busy", createdAt: "2026-02-11T00:00:00.000Z" },
          { id: "w2", name: "paris", branch: "workspace/paris", status: "idle", createdAt: "2026-02-11T00:00:00.000Z" },
        ],
      },
    ];

    const { __wsMock } = await getWsMock();
    renderSidebar("/workspaces/w1", multiWsProjects);

    // Stream only w1
    act(() => {
      __wsMock.emit("w1", { type: "status", status: "busy", streaming: true });
    });

    // Orbit loader should appear only once (for w1)
    const orbitLoaders = screen.getAllByRole("img", { name: "Agent thinking" });
    expect(orbitLoaders).toHaveLength(1);
  });

  it("shows terminal badge icon for workspaces with an active terminal", () => {
    renderSidebar("/workspaces/w1", projects, vi.fn(), ["w1"]);
    const workspaceLink = screen.getByRole("link", { name: /workspace\/tokyo/i });
    expect(workspaceLink.querySelectorAll("svg")).toHaveLength(2);
  });

  it("does not show terminal badge icon when workspace has no active terminal", () => {
    renderSidebar("/workspaces/w1", projects);
    const workspaceLink = screen.getByRole("link", { name: /workspace\/tokyo/i });
    expect(workspaceLink.querySelectorAll("svg")).toHaveLength(1);
  });

  it("displays live branch name from branch_info WS message", async () => {
    const { __wsMock } = await getWsMock();
    renderSidebar("/workspaces/w1", projects);

    expect(screen.getByText("workspace/tokyo")).toBeInTheDocument();

    act(() => {
      __wsMock.emit("w1", {
        type: "branch_info",
        info: { name: "feat/login-page", lastSyncedAt: "2026-02-13T00:00:00.000Z" },
      });
    });

    expect(screen.getByText("feat/login-page")).toBeInTheDocument();
    expect(screen.queryByText("workspace/tokyo")).not.toBeInTheDocument();
  });

  it("shows archive button on workspace hover", () => {
    renderSidebar("/workspaces/w1", projects);

    const archiveBtn = screen.getByRole("button", { name: /archive workspace/i });
    expect(archiveBtn).toBeInTheDocument();
  });

  it("hides archive button when terminal is active", () => {
    renderSidebar("/workspaces/w1", projects, vi.fn(), ["w1"]);

    expect(screen.queryByRole("button", { name: /archive workspace/i })).not.toBeInTheDocument();
  });

  it("shows wave indicator when script is running", async () => {
    const { __wsMock } = await getWsMock();
    renderSidebar("/workspaces/w1", projects);

    const workspaceLink = screen.getByRole("link", { name: /workspace\/tokyo/i });
    // No wave indicator initially
    const svgsBefore = workspaceLink.querySelectorAll("svg");
    expect(svgsBefore).toHaveLength(1); // only GitBranch

    act(() => {
      __wsMock.emit("w1", { type: "script_status", scriptType: "run", state: "running" });
    });

    // Wave indicator SVG should appear (the inline SVG with viewBox="0 0 12 12")
    const svgsAfter = workspaceLink.querySelectorAll("svg");
    expect(svgsAfter.length).toBeGreaterThan(1);
  });

  it("hides wave indicator when script finishes", async () => {
    const { __wsMock } = await getWsMock();
    renderSidebar("/workspaces/w1", projects);

    act(() => {
      __wsMock.emit("w1", { type: "script_status", scriptType: "run", state: "running" });
    });

    const workspaceLink = screen.getByRole("link", { name: /workspace\/tokyo/i });
    expect(workspaceLink.querySelectorAll("svg").length).toBeGreaterThan(1);

    act(() => {
      __wsMock.emit("w1", { type: "script_status", scriptType: "run", state: "done", exitCode: 0 });
    });

    expect(workspaceLink.querySelectorAll("svg")).toHaveLength(1); // back to GitBranch only
  });

  it("hides archive button when script is running", async () => {
    const { __wsMock } = await getWsMock();
    renderSidebar("/workspaces/w1", projects);

    // Archive button exists initially
    expect(screen.getByRole("button", { name: /archive workspace/i })).toBeInTheDocument();

    act(() => {
      __wsMock.emit("w1", { type: "script_status", scriptType: "run", state: "running" });
    });

    expect(screen.queryByRole("button", { name: /archive workspace/i })).not.toBeInTheDocument();
  });

  it("restores archive button when script stops", async () => {
    const { __wsMock } = await getWsMock();
    renderSidebar("/workspaces/w1", projects);

    act(() => {
      __wsMock.emit("w1", { type: "script_status", scriptType: "run", state: "running" });
    });
    expect(screen.queryByRole("button", { name: /archive workspace/i })).not.toBeInTheDocument();

    act(() => {
      __wsMock.emit("w1", { type: "script_status", scriptType: "run", state: "done", exitCode: 0 });
    });
    expect(screen.getByRole("button", { name: /archive workspace/i })).toBeInTheDocument();
  });

  it("archives clean workspace directly without confirmation", async () => {
    const user = userEvent.setup();
    const onArchive = vi.fn().mockResolvedValue(undefined);
    vi.mocked(api.get).mockResolvedValueOnce({ committed: [], uncommitted: [] });

    renderSidebar("/workspaces/w1", projects, vi.fn(), [], onArchive);

    const archiveBtn = screen.getByRole("button", { name: /archive workspace/i });
    await user.click(archiveBtn);

    await waitFor(() => {
      expect(onArchive).toHaveBeenCalledWith("w1");
    });

    // No confirmation dialog should appear
    expect(screen.queryByText("Archive workspace")).not.toBeInTheDocument();
  });

  it("shows confirmation dialog for dirty workspace", async () => {
    const user = userEvent.setup();
    const onArchive = vi.fn().mockResolvedValue(undefined);
    vi.mocked(api.get).mockResolvedValueOnce({
      committed: [],
      uncommitted: [{ file: "dirty.txt", additions: 1, deletions: 0, status: "added" }],
    });

    renderSidebar("/workspaces/w1", projects, vi.fn(), [], onArchive);

    const archiveBtn = screen.getByRole("button", { name: /archive workspace/i });
    await user.click(archiveBtn);

    await waitFor(() => {
      expect(screen.getByText("Archive workspace")).toBeInTheDocument();
    });

    expect(screen.getByText(/uncommitted changes/i)).toBeInTheDocument();
    expect(onArchive).not.toHaveBeenCalled();
  });

  it("confirms archive of dirty workspace via dialog", async () => {
    const user = userEvent.setup();
    const onArchive = vi.fn().mockResolvedValue(undefined);
    vi.mocked(api.get).mockResolvedValueOnce({
      committed: [],
      uncommitted: [{ file: "dirty.txt", additions: 1, deletions: 0, status: "added" }],
    });

    renderSidebar("/workspaces/w1", projects, vi.fn(), [], onArchive);

    const archiveBtn = screen.getByRole("button", { name: /archive workspace/i });
    await user.click(archiveBtn);

    await waitFor(() => {
      expect(screen.getByText("Archive workspace")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => {
      expect(onArchive).toHaveBeenCalledWith("w1");
    });
  });

  it("cancels archive of dirty workspace via dialog", async () => {
    const user = userEvent.setup();
    const onArchive = vi.fn().mockResolvedValue(undefined);
    vi.mocked(api.get).mockResolvedValueOnce({
      committed: [],
      uncommitted: [{ file: "dirty.txt", additions: 1, deletions: 0, status: "added" }],
    });

    renderSidebar("/workspaces/w1", projects, vi.fn(), [], onArchive);

    const archiveBtn = screen.getByRole("button", { name: /archive workspace/i });
    await user.click(archiveBtn);

    await waitFor(() => {
      expect(screen.getByText("Archive workspace")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByText("Archive workspace")).not.toBeInTheDocument();
    });

    expect(onArchive).not.toHaveBeenCalled();
  });

  it("uses cached diffStats from live data when available", async () => {
    const { __wsMock } = await getWsMock();
    const user = userEvent.setup();
    const onArchive = vi.fn().mockResolvedValue(undefined);

    renderSidebar("/workspaces/w1", projects, vi.fn(), [], onArchive);

    // Emit diff_stats via WS so liveData has cached stats (clean workspace)
    act(() => {
      __wsMock.emit("w1", {
        type: "diff_stats",
        stats: { committed: [], uncommitted: [] },
      });
    });

    // Clear any API calls made during setup/subscription
    vi.mocked(api.get).mockClear();

    const archiveBtn = screen.getByRole("button", { name: /archive workspace/i });
    await user.click(archiveBtn);

    await waitFor(() => {
      expect(onArchive).toHaveBeenCalledWith("w1");
    });

    // Should NOT have called the API since cached data was available
    expect(api.get).not.toHaveBeenCalled();
  });

  it("falls back to direct API call when diffStats not cached and API fails", async () => {
    const user = userEvent.setup();
    const onArchive = vi.fn().mockResolvedValue(undefined);
    vi.mocked(api.get).mockRejectedValueOnce(new Error("network error"));

    renderSidebar("/workspaces/w1", projects, vi.fn(), [], onArchive);

    const archiveBtn = screen.getByRole("button", { name: /archive workspace/i });
    await user.click(archiveBtn);

    // When API fails, uncommittedCount falls back to 0 → archives directly
    await waitFor(() => {
      expect(onArchive).toHaveBeenCalledWith("w1");
    });
  });

  it("passes the current route to settings navigation state", async () => {
    const user = userEvent.setup();
    renderSidebar("/workspaces/w1", projects);

    await user.click(screen.getByRole("link", { name: "Settings" }));

    await waitFor(() => {
      expect(screen.getByTestId("settings-from")).toHaveTextContent("/workspaces/w1");
    });
  });
});
