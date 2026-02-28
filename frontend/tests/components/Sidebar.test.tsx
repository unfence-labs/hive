import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Sidebar from "@/components/Sidebar";
import { WorkspaceLiveDataProvider } from "@/contexts/WorkspaceLiveDataContext";
import { api } from "@/hooks/useApi";
import type { Project, PullRequestInfo, WsOutgoing } from "@/types";

/** Match elements whose full textContent equals `text` (handles text split across child spans). */
function withTextContent(text: string) {
  return (_: string, element: Element | null): boolean => {
    if (!element || element.textContent !== text) return false;
    return Array.from(element.children).every((child) => child.textContent !== text);
  };
}

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

function findSidebarUnreadDot(container: HTMLElement) {
  return container.querySelector(
    "span[class*='h-1.5'][class*='w-1.5'][class*='rounded-full'][class*='bg-primary']",
  );
}

function makePr(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    number: 42,
    url: "https://github.com/acme/widget/pull/42",
    state: "open",
    mergeable: true,
    mergeableState: "clean",
    checksStatus: "success",
    checksPassed: null,
    checksTotal: null,
    reviewStatus: null,
    ...overrides,
  };
}

function mockPostWithBulkFallback(overrides: Record<string, unknown | Error>) {
  vi.mocked(api.post).mockImplementation(async (url: string) => {
    if (Object.prototype.hasOwnProperty.call(overrides, url)) {
      const response = overrides[url];
      if (response instanceof Error) throw response;
      return response;
    }
    if (url === "/api/workspaces/pr-status/bulk") return { results: {} };
    throw new Error(`Unexpected POST: ${url}`);
  });
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
    mockPostWithBulkFallback({});
    const { __wsMock } = await getWsMock();
    __wsMock.reset();
  });

  it("renders projects and toggles workspace links from collapsible", async () => {
    const user = userEvent.setup();
    renderSidebar("/projects", projects);

    expect(await screen.findByText(withTextContent("acme/alpha"))).toBeInTheDocument();
    expect(screen.getByText(withTextContent("acme/beta"))).toBeInTheDocument();
    expect(screen.queryByText("workspace/tokyo")).not.toBeInTheDocument();

    await user.click(screen.getByText(withTextContent("acme/alpha")));
    expect(screen.getByText("workspace/tokyo")).toBeInTheDocument();
  });

  it("shows workspace count beside project name only when count is greater than zero", async () => {
    renderSidebar("/projects", projects);

    // Project header: button contains name, sibling div contains count
    const alphaButton = (await screen.findByText(withTextContent("acme/alpha"))).closest("button")!;
    const alphaHeader = alphaButton.parentElement!;
    const betaButton = screen.getByText(withTextContent("acme/beta")).closest("button")!;
    const betaHeader = betaButton.parentElement!;

    // Alpha has 1 workspace → count "1" visible in project header
    expect(alphaHeader.querySelector("[class*='tabular-nums']")).toHaveTextContent("1");
    // Beta has 0 workspaces → count "0" visible in project header
    expect(betaHeader.querySelector("[class*='tabular-nums']")).toHaveTextContent("0");
  });

  it("expands the active project's workspaces on workspace route", async () => {
    renderSidebar("/workspaces/w1", projects);

    expect(await screen.findByText("workspace/tokyo")).toBeInTheDocument();
  });

  it("calls add workspace via API", async () => {
    const user = userEvent.setup();
    mockPostWithBulkFallback({
      "/api/projects/p1/workspaces": {
        id: "w-new",
        name: "osaka",
        branch: "workspace/osaka",
        status: "idle",
        createdAt: "2026-02-12T00:00:00.000Z",
      },
    });
    renderSidebar("/projects", projects);

    await screen.findByText(withTextContent("acme/alpha"));
    await user.click(screen.getByRole("button", { name: "Add workspace to acme/alpha" }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith("/api/projects/p1/workspaces");
    });
  });

  it("navigates to the new workspace after creation", async () => {
    const user = userEvent.setup();
    mockPostWithBulkFallback({
      "/api/projects/p1/workspaces": {
        id: "w-new",
        name: "osaka",
        branch: "workspace/osaka",
        status: "idle",
        createdAt: "2026-02-12T00:00:00.000Z",
      },
    });

    renderSidebar("/projects", projects);
    await screen.findByText(withTextContent("acme/alpha"));

    await user.click(screen.getByRole("button", { name: "Add workspace to acme/alpha" }));

    await waitFor(() => {
      expect(screen.getByTestId("location-path")).toHaveTextContent("/workspaces/w-new");
    });
  });

  it("shows orbit loader on streaming workspace and hides it when idle", async () => {
    const { __wsMock } = await getWsMock();
    renderSidebar("/workspaces/w1", projects);

    await screen.findByText(withTextContent("acme/alpha"));
    expect(screen.queryByRole("img", { name: "Agent thinking" })).not.toBeInTheDocument();
    expect(screen.getByText("workspace/tokyo")).toBeInTheDocument();

    act(() => {
      __wsMock.emit("w1", { type: "status", status: "busy", streaming: true });
    });

    expect(screen.getByRole("img", { name: "Agent thinking" })).toBeInTheDocument();
    expect(screen.getByText(withTextContent("acme/alpha"))).toBeInTheDocument();

    act(() => {
      __wsMock.emit("w1", { type: "status", status: "busy", streaming: false });
    });

    expect(screen.queryByRole("img", { name: "Agent thinking" })).not.toBeInTheDocument();
    expect(screen.getByText("workspace/tokyo")).toBeInTheDocument();
  });

  it("shows orbit loader when streaming and removes it when idle", async () => {
    const { __wsMock } = await getWsMock();
    renderSidebar("/workspaces/w1", projects);

    await screen.findByText("workspace/tokyo");

    // Before streaming: no SVG icons (GitBranch icon is always hidden)
    const workspaceLink = screen.getByRole("link", { name: /workspace\/tokyo/i });
    const svgsBefore = workspaceLink.querySelectorAll("svg");
    expect(svgsBefore.length).toBe(0);

    act(() => {
      __wsMock.emit("w1", { type: "status", status: "busy", streaming: true });
    });

    // While streaming: orbit loader SVG appears
    const svgsStreaming = workspaceLink.querySelectorAll("svg");
    const orbitSvg = Array.from(svgsStreaming).find(
      (svg) => svg.getAttribute("aria-label") === "Agent thinking",
    );
    expect(orbitSvg).toBeTruthy();

    act(() => {
      __wsMock.emit("w1", { type: "status", status: "busy", streaming: false });
    });

    // After streaming stops: no SVGs again
    expect(screen.queryByRole("img", { name: "Agent thinking" })).not.toBeInTheDocument();
    const svgsAfter = workspaceLink.querySelectorAll("svg");
    expect(svgsAfter.length).toBe(0);
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

    await screen.findByText(withTextContent("acme/alpha"));

    // Stream only w1
    act(() => {
      __wsMock.emit("w1", { type: "status", status: "busy", streaming: true });
    });

    // Orbit loader should appear only once (for w1)
    const orbitLoaders = screen.getAllByRole("img", { name: "Agent thinking" });
    expect(orbitLoaders).toHaveLength(1);
  });

  it("shows unread dot for inactive workspace after done event", async () => {
    const multiWsProjects: Project[] = [
      {
        id: "p1",
        name: "Alpha",
        url: "https://github.com/acme/alpha.git",
        createdAt: "2026-02-11T00:00:00.000Z",
        workspaces: [
          { id: "w1", name: "tokyo", branch: "workspace/tokyo", status: "idle", createdAt: "2026-02-11T00:00:00.000Z" },
          { id: "w2", name: "paris", branch: "workspace/paris", status: "idle", createdAt: "2026-02-11T00:00:00.000Z" },
        ],
      },
    ];

    const { __wsMock } = await getWsMock();
    renderSidebar("/workspaces/w1", multiWsProjects);

    await screen.findByText("workspace/paris");

    act(() => {
      __wsMock.emit("w2", { type: "done", sessionId: "sess-2" });
    });

    const inactiveLink = screen.getByRole("link", { name: /workspace\/paris/i });
    expect(findSidebarUnreadDot(inactiveLink)).toBeInTheDocument();
    expect(inactiveLink.querySelector("svg.lucide-git-branch")).toBeNull();
  });

  it("shows unread dot even for the active workspace when a session completes", async () => {
    const { __wsMock } = await getWsMock();
    renderSidebar("/workspaces/w1", projects);

    await screen.findByText("workspace/tokyo");

    act(() => {
      __wsMock.emit("w1", { type: "done", sessionId: "sess-1" });
    });

    const activeLink = screen.getByRole("link", { name: /workspace\/tokyo/i });
    expect(findSidebarUnreadDot(activeLink)).not.toBeNull();
  });

  it("prioritizes streaming indicator over unread dot and restores dot when idle again", async () => {
    const multiWsProjects: Project[] = [
      {
        id: "p1",
        name: "Alpha",
        url: "https://github.com/acme/alpha.git",
        createdAt: "2026-02-11T00:00:00.000Z",
        workspaces: [
          { id: "w1", name: "tokyo", branch: "workspace/tokyo", status: "idle", createdAt: "2026-02-11T00:00:00.000Z" },
          { id: "w2", name: "paris", branch: "workspace/paris", status: "idle", createdAt: "2026-02-11T00:00:00.000Z" },
        ],
      },
    ];

    const { __wsMock } = await getWsMock();
    renderSidebar("/workspaces/w1", multiWsProjects);

    await screen.findByText("workspace/paris");
    const inactiveLink = screen.getByRole("link", { name: /workspace\/paris/i });

    act(() => {
      __wsMock.emit("w2", { type: "done", sessionId: "sess-2" });
    });
    expect(findSidebarUnreadDot(inactiveLink)).toBeInTheDocument();

    act(() => {
      __wsMock.emit("w2", { type: "status", status: "busy", sessionId: "sess-2", streaming: true });
    });
    expect(inactiveLink.querySelector("[aria-label='Agent thinking']")).toBeInTheDocument();
    expect(findSidebarUnreadDot(inactiveLink)).toBeNull();

    act(() => {
      __wsMock.emit("w2", { type: "status", status: "busy", sessionId: "sess-2", streaming: false });
    });
    expect(inactiveLink.querySelector("[aria-label='Agent thinking']")).not.toBeInTheDocument();
    expect(findSidebarUnreadDot(inactiveLink)).toBeInTheDocument();
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
    // No wave indicator initially (no SVGs — GitBranch icon is always hidden)
    const svgsBefore = workspaceLink.querySelectorAll("svg");
    expect(svgsBefore).toHaveLength(0);

    act(() => {
      __wsMock.emit("w1", { type: "script_status", scriptType: "run", state: "running" });
    });

    // Wave indicator SVG should appear (the inline SVG with viewBox="0 0 12 12")
    const svgsAfter = workspaceLink.querySelectorAll("svg");
    expect(svgsAfter.length).toBeGreaterThan(0);
  });

  it("hides wave indicator when script finishes", async () => {
    const { __wsMock } = await getWsMock();
    renderSidebar("/workspaces/w1", projects);

    await screen.findByText("workspace/tokyo");

    act(() => {
      __wsMock.emit("w1", { type: "script_status", scriptType: "run", state: "running" });
    });

    const workspaceLink = screen.getByRole("link", { name: /workspace\/tokyo/i });
    expect(workspaceLink.querySelectorAll("svg").length).toBeGreaterThan(0);

    act(() => {
      __wsMock.emit("w1", { type: "script_status", scriptType: "run", state: "done", exitCode: 0 });
    });

    expect(workspaceLink.querySelectorAll("svg")).toHaveLength(0); // no SVGs at rest
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
    mockPostWithBulkFallback({
      "/api/workspaces/w1/archive": undefined,
    });

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
    mockPostWithBulkFallback({
      "/api/workspaces/w1/archive": undefined,
    });

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
    mockPostWithBulkFallback({
      "/api/workspaces/w1/archive": undefined,
    });

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
    mockPostWithBulkFallback({
      "/api/workspaces/w1/archive": undefined,
    });

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

  it("shows PR loading text while bulk status is in flight", async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise((res) => {
      resolve = res;
    });

    mockPostWithBulkFallback({
      "/api/workspaces/pr-status/bulk": pending,
    });

    renderSidebar("/workspaces/w1", projects);

    expect(await screen.findByText("Loading…")).toBeInTheDocument();

    resolve({ results: {} });
    await waitFor(() => {
      expect(screen.getByText("No PR")).toBeInTheDocument();
    });
  });

  it("shows compact PR info when a PR exists", async () => {
    mockPostWithBulkFallback({
      "/api/workspaces/pr-status/bulk": {
        results: {
          w1: { pr: makePr({ number: 7, mergeable: true, mergeableState: "clean" }) },
        },
      },
    });

    renderSidebar("/workspaces/w1", projects);

    expect(await screen.findByText("#7 Ready")).toBeInTheDocument();
  });

  it("shows PR error text when backend reports an error for a workspace", async () => {
    mockPostWithBulkFallback({
      "/api/workspaces/pr-status/bulk": {
        results: {
          w1: { pr: null, error: "gh unavailable" },
        },
      },
    });

    renderSidebar("/workspaces/w1", projects);

    expect(await screen.findByText("Error fetching PR")).toBeInTheDocument();
  });
});
