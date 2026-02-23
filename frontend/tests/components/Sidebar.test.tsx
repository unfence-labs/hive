import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Sidebar from "@/components/Sidebar";
import { WorkspaceLiveDataProvider } from "@/contexts/WorkspaceLiveDataContext";
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

function SettingsStateProbe() {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "none";
  return <div data-testid="settings-from">{from}</div>;
}

function SidebarRoute() {
  const location = useLocation();
  return (
    <>
      <Sidebar onAddProject={vi.fn()} />
      <div data-testid="location-path">{location.pathname}</div>
    </>
  );
}

function renderSidebar(
  path: string,
  projects: Project[],
  apiOverrides?: {
    diffStat?: Record<string, unknown> | Error;
  },
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url === "/api/projects") return projects;
    const diffMatch = url.match(/^\/api\/workspaces\/([^/]+)\/diff\/stat$/);
    if (diffMatch) {
      const override = apiOverrides?.diffStat;
      if (override instanceof Error) throw override;
      if (override) return override;
      return { committed: [], uncommitted: [] };
    }
    throw new Error(`Unexpected GET: ${url}`);
  });

  const workspaceIds = projects.flatMap((p) => (p.workspaces ?? []).map((ws) => ws.id));

  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceLiveDataProvider workspaceIds={workspaceIds}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path="/projects"
              element={<SidebarRoute />}
            />
            <Route
              path="/workspaces/:wsId"
              element={<SidebarRoute />}
            />
            <Route path="/settings" element={<SettingsStateProbe />} />
          </Routes>
        </MemoryRouter>
      </WorkspaceLiveDataProvider>
    </QueryClientProvider>,
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
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.delete).mockReset();
    const { __wsMock } = await getWsMock();
    __wsMock.reset();
  });

  it("renders projects and toggles workspace links from collapsible", async () => {
    const user = userEvent.setup();
    renderSidebar("/projects", projects);

    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.queryByText("workspace/tokyo")).not.toBeInTheDocument();

    await user.click(screen.getByText("Alpha"));
    expect(screen.getByText("workspace/tokyo")).toBeInTheDocument();
  });

  it("shows workspace count beside project name only when count is greater than zero", async () => {
    renderSidebar("/projects", projects);

    const alphaLabel = (await screen.findByText("Alpha")).closest("span");
    const betaLabel = screen.getByText("Beta").closest("span");

    expect(alphaLabel).toBeInTheDocument();
    expect(alphaLabel?.querySelector("span")).toHaveTextContent("1");
    expect(betaLabel).toBeInTheDocument();
    expect(betaLabel?.querySelector("span")).toBeNull();
  });

  it("expands the active project's workspaces on workspace route", async () => {
    renderSidebar("/workspaces/w1", projects);

    expect(await screen.findByText("workspace/tokyo")).toBeInTheDocument();
  });

  it("calls add workspace via API", async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValue({
      id: "w-new",
      name: "osaka",
      branch: "workspace/osaka",
      status: "idle",
      createdAt: "2026-02-12T00:00:00.000Z",
    });
    renderSidebar("/projects", projects);

    await screen.findByText("Alpha");
    await user.click(screen.getByRole("button", { name: "Add workspace to Alpha" }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith("/api/projects/p1/workspaces");
    });
  });

  it("navigates to the new workspace after creation", async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValue({
      id: "w-new",
      name: "osaka",
      branch: "workspace/osaka",
      status: "idle",
      createdAt: "2026-02-12T00:00:00.000Z",
    });

    renderSidebar("/projects", projects);
    await screen.findByText("Alpha");

    await user.click(screen.getByRole("button", { name: "Add workspace to Alpha" }));

    await waitFor(() => {
      expect(screen.getByTestId("location-path")).toHaveTextContent("/workspaces/w-new");
    });
  });

  it("shows orbit loader on streaming workspace and hides it when idle", async () => {
    const { __wsMock } = await getWsMock();
    renderSidebar("/workspaces/w1", projects);

    await screen.findByText("Alpha");
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

    await screen.findByText("workspace/tokyo");

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

    await screen.findByText("Alpha");

    // Stream only w1
    act(() => {
      __wsMock.emit("w1", { type: "status", status: "busy", streaming: true });
    });

    // Orbit loader should appear only once (for w1)
    const orbitLoaders = screen.getAllByRole("img", { name: "Agent thinking" });
    expect(orbitLoaders).toHaveLength(1);
  });

  it("displays live branch name from branch_info WS message", async () => {
    const { __wsMock } = await getWsMock();
    renderSidebar("/workspaces/w1", projects);

    expect(await screen.findByText("workspace/tokyo")).toBeInTheDocument();

    act(() => {
      __wsMock.emit("w1", {
        type: "branch_info",
        info: { name: "feat/login-page", lastSyncedAt: "2026-02-13T00:00:00.000Z" },
      });
    });

    expect(screen.getByText("feat/login-page")).toBeInTheDocument();
    expect(screen.queryByText("workspace/tokyo")).not.toBeInTheDocument();
  });

  it("shows archive button on workspace hover", async () => {
    renderSidebar("/workspaces/w1", projects);

    await screen.findByText("workspace/tokyo");
    const archiveBtn = screen.getByRole("button", { name: /archive workspace/i });
    expect(archiveBtn).toBeInTheDocument();
  });

  it("shows wave indicator when script is running", async () => {
    const { __wsMock } = await getWsMock();
    renderSidebar("/workspaces/w1", projects);

    await screen.findByText("workspace/tokyo");
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

    await screen.findByText("workspace/tokyo");

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

    await screen.findByText("workspace/tokyo");

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

    await screen.findByText("workspace/tokyo");

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
    vi.mocked(api.post).mockResolvedValue(undefined);

    renderSidebar("/workspaces/w1", projects, {
      diffStat: { committed: [], uncommitted: [] },
    });

    await screen.findByText("workspace/tokyo");
    const archiveBtn = screen.getByRole("button", { name: /archive workspace/i });
    await user.click(archiveBtn);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith("/api/workspaces/w1/archive");
    });

    // No confirmation dialog should appear
    expect(screen.queryByText("Archive workspace")).not.toBeInTheDocument();
  });

  it("shows confirmation dialog for dirty workspace", async () => {
    const user = userEvent.setup();

    renderSidebar("/workspaces/w1", projects, {
      diffStat: {
        committed: [],
        uncommitted: [{ file: "dirty.txt", additions: 1, deletions: 0, status: "added" }],
      },
    });

    await screen.findByText("workspace/tokyo");
    const archiveBtn = screen.getByRole("button", { name: /archive workspace/i });
    await user.click(archiveBtn);

    await waitFor(() => {
      expect(screen.getByText("Archive workspace")).toBeInTheDocument();
    });

    expect(screen.getByText(/uncommitted changes/i)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalledWith("/api/workspaces/w1/archive");
  });

  it("confirms archive of dirty workspace via dialog", async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValue(undefined);

    renderSidebar("/workspaces/w1", projects, {
      diffStat: {
        committed: [],
        uncommitted: [{ file: "dirty.txt", additions: 1, deletions: 0, status: "added" }],
      },
    });

    await screen.findByText("workspace/tokyo");
    const archiveBtn = screen.getByRole("button", { name: /archive workspace/i });
    await user.click(archiveBtn);

    await waitFor(() => {
      expect(screen.getByText("Archive workspace")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith("/api/workspaces/w1/archive");
    });
  });

  it("cancels archive of dirty workspace via dialog", async () => {
    const user = userEvent.setup();

    renderSidebar("/workspaces/w1", projects, {
      diffStat: {
        committed: [],
        uncommitted: [{ file: "dirty.txt", additions: 1, deletions: 0, status: "added" }],
      },
    });

    await screen.findByText("workspace/tokyo");
    const archiveBtn = screen.getByRole("button", { name: /archive workspace/i });
    await user.click(archiveBtn);

    await waitFor(() => {
      expect(screen.getByText("Archive workspace")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByText("Archive workspace")).not.toBeInTheDocument();
    });

    expect(api.post).not.toHaveBeenCalledWith("/api/workspaces/w1/archive");
  });

  it("uses cached diffStats from live data when available", async () => {
    const { __wsMock } = await getWsMock();
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValue(undefined);

    renderSidebar("/workspaces/w1", projects);

    await screen.findByText("workspace/tokyo");

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
      expect(api.post).toHaveBeenCalledWith("/api/workspaces/w1/archive");
    });

    // Should NOT have called the diff stat API since cached data was available
    expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining("/diff/stat"));
  });

  it("falls back to direct API call when diffStats not cached and API fails", async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValue(undefined);

    renderSidebar("/workspaces/w1", projects, {
      diffStat: new Error("network error"),
    });

    await screen.findByText("workspace/tokyo");
    const archiveBtn = screen.getByRole("button", { name: /archive workspace/i });
    await user.click(archiveBtn);

    // When API fails, uncommittedCount falls back to 0 -> archives directly
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith("/api/workspaces/w1/archive");
    });
  });

  it("passes the current route to settings navigation state", async () => {
    const user = userEvent.setup();
    renderSidebar("/workspaces/w1", projects);

    await screen.findByText("workspace/tokyo");
    await user.click(screen.getByRole("link", { name: "Settings" }));

    await waitFor(() => {
      expect(screen.getByTestId("settings-from")).toHaveTextContent("/workspaces/w1");
    });
  });
});
