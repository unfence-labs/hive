import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    put: vi.fn(),
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
    onReconnect: vi.fn(() => () => {}),
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
    automations?: Record<string, unknown>[] | Error;
  },
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url === "/api/projects") return projects;
    if (url === "/api/automations") {
      const override = apiOverrides?.automations;
      if (override instanceof Error) throw override;
      return override ?? [];
    }
    if (url === "/api/ui-preferences") {
      return { sidebar: { folders: [], folderOpenState: {} } };
    }
    const diffMatch = url.match(/^\/api\/workspaces\/([^/]+)\/diff\/stat$/);
    if (diffMatch) {
      const override = apiOverrides?.diffStat;
      if (override instanceof Error) throw override;
      if (override) return override;
      return { committed: [], uncommitted: [] };
    }
    throw new Error(`Unexpected GET: ${url}`);
  });

  vi.mocked(api.put).mockImplementation(async (url: string, body?: unknown) => {
    if (url === "/api/ui-preferences") return body;
    throw new Error(`Unexpected PUT: ${url}`);
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
              path="/home"
              element={<SidebarRoute />}
            />
            <Route
              path="/workspaces/:wsId"
              element={<SidebarRoute />}
            />
            <Route
              path="/automations/:automationId"
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
    "span[class*='rounded-full'][class*='bg-primary']",
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

function createDataTransfer(): DataTransfer {
  const data = new Map<string, string>();
  const types = new Set<string>();
  const transfer = {
    dropEffect: "move",
    effectAllowed: "move",
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [] as string[],
    clearData: (format?: string) => {
      if (format) {
        data.delete(format);
        types.delete(format);
      } else {
        data.clear();
        types.clear();
      }
      transfer.types = [...types];
    },
    getData: (format: string) => data.get(format) ?? "",
    setData: (format: string, value: string) => {
      data.set(format, value);
      types.add(format);
      transfer.types = [...types];
    },
    setDragImage: vi.fn(),
  };

  return transfer as unknown as DataTransfer;
}

function expectFolderOrder(labels: string[]) {
  const actual = Array.from(document.querySelectorAll("[data-sidebar-folder] > div > button")).map(
    (button) => button.textContent?.trim() ?? "",
  );
  expect(actual).toEqual(labels);
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
    vi.mocked(api.put).mockReset();
    vi.mocked(api.delete).mockReset();
    localStorage.removeItem("hive:sidebar-project-folders:v1");
    localStorage.removeItem("hive:sidebar-project-folders:cache:v1");
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

  it("creates collapsible folders from the workspaces header", async () => {
    const user = userEvent.setup();
    renderSidebar("/projects", projects);

    await screen.findByText(withTextContent("acme/alpha"));
    await user.click(screen.getByRole("button", { name: "New folder" }));
    await user.type(screen.getByLabelText("Folder name"), "Client work");
    await user.click(screen.getByRole("button", { name: "Create folder" }));

    expect(await screen.findByRole("button", { name: "Client work" })).toBeInTheDocument();
    expect(screen.getByText("Drop repositories here")).toBeInTheDocument();
  });

  it("persists folder changes to /api/ui-preferences", async () => {
    const user = userEvent.setup();
    renderSidebar("/projects", projects);

    await screen.findByText(withTextContent("acme/alpha"));
    await user.click(screen.getByRole("button", { name: "New folder" }));
    await user.type(screen.getByLabelText("Folder name"), "Client work");
    await user.click(screen.getByRole("button", { name: "Create folder" }));

    await waitFor(
      () => {
        expect(api.put).toHaveBeenCalledWith(
          "/api/ui-preferences",
          expect.objectContaining({
            sidebar: expect.objectContaining({
              folders: expect.arrayContaining([
                expect.objectContaining({ name: "Client work" }),
              ]),
            }),
          }),
        );
      },
      { timeout: 2000 },
    );
  });

  it("hydrates folders from the server response", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === "/api/projects") return projects;
      if (url === "/api/automations") return [];
      if (url === "/api/ui-preferences") {
        return {
          sidebar: {
            folders: [{ id: "remote-folder", name: "Server Folder", projectIds: ["p2"] }],
            folderOpenState: { "remote-folder": true },
          },
        };
      }
      return { committed: [], uncommitted: [] };
    });

    render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceLiveDataProvider workspaceIds={["w1"]}>
          <MemoryRouter initialEntries={["/projects"]}>
            <Routes>
              <Route path="/projects" element={<SidebarRoute />} />
            </Routes>
          </MemoryRouter>
        </WorkspaceLiveDataProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("button", { name: "Server Folder" })).toBeInTheDocument();
    const folder = screen.getByText("Server Folder").closest("[data-sidebar-folder]");
    expect(folder).not.toBeNull();
    expect(folder!.textContent).toContain("acme/beta");
  });

  it("migrates legacy localStorage to the backend on first hydration", async () => {
    localStorage.setItem(
      "hive:sidebar-project-folders:v1",
      JSON.stringify({
        folders: [{ id: "legacy", name: "Migrated", projectIds: ["p1"] }],
        folderOpenState: { legacy: true },
      }),
    );

    renderSidebar("/projects", projects);

    await waitFor(
      () => {
        expect(api.put).toHaveBeenCalledWith(
          "/api/ui-preferences",
          expect.objectContaining({
            sidebar: expect.objectContaining({
              folders: expect.arrayContaining([
                expect.objectContaining({ name: "Migrated", projectIds: ["p1"] }),
              ]),
            }),
          }),
        );
      },
      { timeout: 2000 },
    );

    expect(localStorage.getItem("hive:sidebar-project-folders:v1")).toBeNull();
  });

  it("moves a project into a folder via drag and drop", async () => {
    const user = userEvent.setup();
    renderSidebar("/projects", projects);

    await screen.findByText(withTextContent("acme/alpha"));
    await user.click(screen.getByRole("button", { name: "New folder" }));
    await user.type(screen.getByLabelText("Folder name"), "Client work");
    await user.click(screen.getByRole("button", { name: "Create folder" }));

    const betaButton = screen.getByText(withTextContent("acme/beta")).closest("button");
    const folder = screen.getByText("Client work").closest("[data-sidebar-folder]");
    expect(betaButton).not.toBeNull();
    expect(folder).not.toBeNull();

    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(betaButton!, { dataTransfer });
    fireEvent.dragOver(folder!, { dataTransfer });
    fireEvent.drop(folder!, { dataTransfer });
    fireEvent.dragEnd(betaButton!, { dataTransfer });

    await waitFor(() => {
      expect(screen.getByText(withTextContent("acme/beta")).closest("[data-sidebar-folder]")).toBe(folder);
    });
  });

  it("collapses folders and hides their projects", async () => {
    const user = userEvent.setup();
    renderSidebar("/projects", projects);

    await screen.findByText(withTextContent("acme/alpha"));
    await user.click(screen.getByRole("button", { name: "New folder" }));
    await user.type(screen.getByLabelText("Folder name"), "Client work");
    await user.click(screen.getByRole("button", { name: "Create folder" }));

    const folder = screen.getByText("Client work").closest("[data-sidebar-folder]");
    expect(folder).not.toBeNull();

    const dataTransfer = createDataTransfer();
    const betaButton = screen.getByText(withTextContent("acme/beta")).closest("button");
    expect(betaButton).not.toBeNull();
    fireEvent.dragStart(betaButton!, { dataTransfer });
    fireEvent.dragOver(folder!, { dataTransfer });
    fireEvent.drop(folder!, { dataTransfer });
    fireEvent.dragEnd(betaButton!, { dataTransfer });

    expect(await screen.findByText(withTextContent("acme/beta"))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Client work" }));

    await waitFor(() => {
      expect(screen.queryByText(withTextContent("acme/beta"))).not.toBeInTheDocument();
    });
  });

  it("reorders projects within a folder via drag and drop", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === "/api/projects") return projects;
      if (url === "/api/automations") return [];
      if (url === "/api/ui-preferences") {
        return {
          sidebar: {
            folders: [{ id: "f-client", name: "Client", projectIds: ["p1", "p2"] }],
            folderOpenState: { "f-client": true },
          },
        };
      }
      return { committed: [], uncommitted: [] };
    });

    vi.mocked(api.put).mockImplementation(async (_url: string, body?: unknown) => body);

    render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceLiveDataProvider workspaceIds={["w1"]}>
          <MemoryRouter initialEntries={["/projects"]}>
            <Routes>
              <Route path="/projects" element={<SidebarRoute />} />
            </Routes>
          </MemoryRouter>
        </WorkspaceLiveDataProvider>
      </QueryClientProvider>,
    );

    await screen.findByRole("button", { name: "Client" });

    const folderContainer = screen.getByText("Client").closest("[data-sidebar-folder]")!;
    const projectItems = () =>
      Array.from(folderContainer.querySelectorAll("[data-sidebar-project]")).map(
        (el) => el.getAttribute("data-sidebar-project"),
      );

    expect(projectItems()).toEqual(["p1", "p2"]);

    const betaButton = screen.getByText(withTextContent("acme/beta")).closest("button")!;
    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(betaButton, { dataTransfer });

    const alphaItem = folderContainer.querySelector("[data-sidebar-project='p1']")!;
    const beforeZone = alphaItem.querySelector("[data-project-reorder='before']")!;
    expect(beforeZone).not.toBeNull();

    fireEvent.dragOver(beforeZone, { dataTransfer });
    fireEvent.drop(beforeZone, { dataTransfer });
    fireEvent.dragEnd(betaButton, { dataTransfer });

    await waitFor(() => {
      expect(projectItems()).toEqual(["p2", "p1"]);
    });
  });

  it("moves a project between folders at a specific position via drag and drop", async () => {
    const multiProjects: Project[] = [
      ...projects,
      {
        id: "p3",
        name: "Gamma",
        url: "https://github.com/acme/gamma.git",
        createdAt: "2026-02-11T00:00:00.000Z",
        workspaces: [],
      },
    ];

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === "/api/projects") return multiProjects;
      if (url === "/api/automations") return [];
      if (url === "/api/ui-preferences") {
        return {
          sidebar: {
            folders: [
              { id: "f-a", name: "Folder A", projectIds: ["p1", "p2"] },
              { id: "f-b", name: "Folder B", projectIds: ["p3"] },
            ],
            folderOpenState: { "f-a": true, "f-b": true },
          },
        };
      }
      return { committed: [], uncommitted: [] };
    });

    vi.mocked(api.put).mockImplementation(async (_url: string, body?: unknown) => body);

    render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceLiveDataProvider workspaceIds={["w1"]}>
          <MemoryRouter initialEntries={["/projects"]}>
            <Routes>
              <Route path="/projects" element={<SidebarRoute />} />
            </Routes>
          </MemoryRouter>
        </WorkspaceLiveDataProvider>
      </QueryClientProvider>,
    );

    await screen.findByRole("button", { name: "Folder B" });

    const folderB = screen.getByText("Folder B").closest("[data-sidebar-folder]")!;
    const folderBProjectIds = () =>
      Array.from(folderB.querySelectorAll("[data-sidebar-project]")).map(
        (el) => el.getAttribute("data-sidebar-project"),
      );

    expect(folderBProjectIds()).toEqual(["p3"]);

    const alphaButton = screen.getByText(withTextContent("acme/alpha")).closest("button")!;
    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(alphaButton, { dataTransfer });

    const gammaItem = folderB.querySelector("[data-sidebar-project='p3']")!;
    const beforeZone = gammaItem.querySelector("[data-project-reorder='before']")!;
    expect(beforeZone).not.toBeNull();

    fireEvent.dragOver(beforeZone, { dataTransfer });
    fireEvent.drop(beforeZone, { dataTransfer });
    fireEvent.dragEnd(alphaButton, { dataTransfer });

    await waitFor(() => {
      expect(folderBProjectIds()).toEqual(["p1", "p3"]);
    });
  });

  it("reorders folders by dragging one before another", async () => {
    const user = userEvent.setup();
    renderSidebar("/projects", projects);

    await screen.findByText(withTextContent("acme/alpha"));
    await user.click(screen.getByRole("button", { name: "New folder" }));
    await user.type(screen.getByLabelText("Folder name"), "Client work");
    await user.click(screen.getByRole("button", { name: "Create folder" }));
    await user.click(screen.getByRole("button", { name: "New folder" }));
    await user.type(screen.getByLabelText("Folder name"), "Infra");
    await user.click(screen.getByRole("button", { name: "Create folder" }));

    expectFolderOrder(["Client work", "Infra"]);

    const infraButton = screen.getByRole("button", { name: "Infra" });
    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(infraButton, { dataTransfer });

    const clientFolder = screen.getByText("Client work").closest("[data-sidebar-folder]");
    expect(clientFolder).not.toBeNull();
    const beforeZone = clientFolder!.querySelector("[data-folder-reorder='before']");
    expect(beforeZone).not.toBeNull();

    fireEvent.dragOver(beforeZone!, { dataTransfer });
    fireEvent.drop(beforeZone!, { dataTransfer });
    fireEvent.dragEnd(infraButton, { dataTransfer });

    await waitFor(() => {
      expectFolderOrder(["Infra", "Client work"]);
    });
  });

  it("renames a folder via the inline rename input", async () => {
    const user = userEvent.setup();
    renderSidebar("/projects", projects);

    await screen.findByText(withTextContent("acme/alpha"));
    await user.click(screen.getByRole("button", { name: "New folder" }));
    await user.type(screen.getByLabelText("Folder name"), "Old name");
    await user.click(screen.getByRole("button", { name: "Create folder" }));

    await screen.findByRole("button", { name: "Old name" });

    fireEvent.click(screen.getByRole("button", { name: "Rename folder Old name" }));

    const input = await screen.findByLabelText("Rename folder");
    await user.clear(input);
    await user.type(input, "Renamed folder{Enter}");

    expect(await screen.findByRole("button", { name: "Renamed folder" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Old name" })).not.toBeInTheDocument();
  });

  it("cancels folder rename when Escape is pressed", async () => {
    const user = userEvent.setup();
    renderSidebar("/projects", projects);

    await screen.findByText(withTextContent("acme/alpha"));
    await user.click(screen.getByRole("button", { name: "New folder" }));
    await user.type(screen.getByLabelText("Folder name"), "Keep me");
    await user.click(screen.getByRole("button", { name: "Create folder" }));

    await screen.findByRole("button", { name: "Keep me" });

    fireEvent.click(screen.getByRole("button", { name: "Rename folder Keep me" }));

    const input = await screen.findByLabelText("Rename folder");
    await user.clear(input);
    await user.type(input, "Discarded{Escape}");

    expect(await screen.findByRole("button", { name: "Keep me" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Rename folder")).not.toBeInTheDocument();
  });

  it("deletes an empty folder after confirmation", async () => {
    const user = userEvent.setup();
    renderSidebar("/projects", projects);

    await screen.findByText(withTextContent("acme/alpha"));
    await user.click(screen.getByRole("button", { name: "New folder" }));
    await user.type(screen.getByLabelText("Folder name"), "Temporary");
    await user.click(screen.getByRole("button", { name: "Create folder" }));

    await screen.findByRole("button", { name: "Temporary" });

    fireEvent.click(screen.getByRole("button", { name: "Delete folder Temporary" }));

    const confirm = await screen.findByRole("button", { name: "Delete" });
    await user.click(confirm);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Temporary" })).not.toBeInTheDocument();
    });
  });

  it("hides the delete button for non-empty folders", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === "/api/projects") return projects;
      if (url === "/api/automations") return [];
      if (url === "/api/ui-preferences") {
        return {
          sidebar: {
            folders: [{ id: "f-client", name: "Client", projectIds: ["p1"] }],
            folderOpenState: { "f-client": true },
          },
        };
      }
      return { committed: [], uncommitted: [] };
    });

    render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceLiveDataProvider workspaceIds={["w1"]}>
          <MemoryRouter initialEntries={["/projects"]}>
            <Routes>
              <Route path="/projects" element={<SidebarRoute />} />
            </Routes>
          </MemoryRouter>
        </WorkspaceLiveDataProvider>
      </QueryClientProvider>,
    );

    await screen.findByRole("button", { name: "Client" });

    expect(screen.queryByRole("button", { name: "Delete folder Client" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename folder Client" })).toBeInTheDocument();
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

  // ── Sidebar card CSS classes ──────────────────────────────────────

  it("applies sidebar-card class to workspace links", async () => {
    renderSidebar("/workspaces/w1", projects);
    await screen.findByText("workspace/tokyo");

    const wsLink = screen.getByRole("link", { name: /workspace\/tokyo/i });
    expect(wsLink.className).toContain("sidebar-card");
  });

  it("applies sidebar-card-active class to the active workspace", async () => {
    renderSidebar("/workspaces/w1", projects);
    await screen.findByText("workspace/tokyo");

    const wsLink = screen.getByRole("link", { name: /workspace\/tokyo/i });
    expect(wsLink.className).toContain("sidebar-card-active");
  });

  it("does not apply sidebar-card-active to inactive workspaces", async () => {
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

    renderSidebar("/workspaces/w1", multiWsProjects);
    await screen.findByText("workspace/paris");

    const inactiveLink = screen.getByRole("link", { name: /workspace\/paris/i });
    expect(inactiveLink.className).toContain("sidebar-card");
    expect(inactiveLink.className).not.toContain("sidebar-card-active");
  });

  // ── Automations section ──────────────────────────────────────────

  it("shows 'Automations' section header", async () => {
    renderSidebar("/home", projects);
    expect(await screen.findByText("Automations")).toBeInTheDocument();
  });

  it("shows automation empty state when no automations exist", async () => {
    renderSidebar("/home", projects, { automations: [] });
    expect(await screen.findByText("no automations")).toBeInTheDocument();
  });

  it("shows loading skeleton while automations are loading", async () => {
    // Use a pending promise so the query never resolves
    let resolveAutomations!: (value: unknown) => void;
    const pendingAutomations = new Promise((res) => { resolveAutomations = res; });

    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === "/api/projects") return projects;
      if (url === "/api/automations") return pendingAutomations;
      if (url === "/api/ui-preferences") {
        return { sidebar: { folders: [], folderOpenState: {} } };
      }
      return { committed: [], uncommitted: [] };
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceLiveDataProvider workspaceIds={["w1"]}>
          <MemoryRouter initialEntries={["/home"]}>
            <Routes>
              <Route path="/home" element={<SidebarRoute />} />
            </Routes>
          </MemoryRouter>
        </WorkspaceLiveDataProvider>
      </QueryClientProvider>,
    );

    // While loading, skeletons should be rendered, not the empty state
    expect(screen.queryByText("no automations")).not.toBeInTheDocument();

    // Resolve to empty array
    resolveAutomations([]);
    await waitFor(() => {
      expect(screen.getByText("no automations")).toBeInTheDocument();
    });
  });

  it("renders automation rows sorted by running > enabled > disabled", async () => {
    const automations = [
      {
        id: "a3",
        name: "Disabled job",
        enabled: false,
        trigger: { type: "cron", expression: "0 * * * *" },
        action: { type: "agent", modelId: "claude:opus-4-6", userPromptInline: "x" },
        notification: { onComplete: false, onFailure: false },
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "a1",
        name: "Running job",
        enabled: true,
        lastRunStatus: "running",
        trigger: { type: "cron", expression: "0 2 * * *" },
        action: { type: "agent", modelId: "claude:opus-4-6", userPromptInline: "x" },
        notification: { onComplete: false, onFailure: false },
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "a2",
        name: "Enabled job",
        enabled: true,
        trigger: { type: "cron", expression: "0 8 * * *" },
        action: { type: "agent", modelId: "claude:opus-4-6", userPromptInline: "x" },
        notification: { onComplete: false, onFailure: false },
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ];

    renderSidebar("/home", projects, { automations });

    const links = await waitFor(() => {
      const items = screen.getAllByRole("link").filter((el) =>
        el.getAttribute("href")?.startsWith("/automations/"),
      );
      expect(items).toHaveLength(3);
      return items;
    });

    // Verify order: Running (a1) → Enabled (a2) → Disabled (a3)
    expect(links[0]).toHaveTextContent("Running job");
    expect(links[1]).toHaveTextContent("Enabled job");
    expect(links[2]).toHaveTextContent("Disabled job");
  });

  it("shows 'running' label for running automations", async () => {
    const automations = [
      {
        id: "a1",
        name: "My automation",
        enabled: true,
        lastRunStatus: "running",
        trigger: { type: "cron", expression: "0 2 * * *" },
        action: { type: "agent", modelId: "claude:opus-4-6", userPromptInline: "x" },
        notification: { onComplete: false, onFailure: false },
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ];

    renderSidebar("/home", projects, { automations });
    expect(await screen.findByText("running")).toBeInTheDocument();
  });

  it("shows 'disabled' label for disabled automations", async () => {
    const automations = [
      {
        id: "a1",
        name: "Disabled auto",
        enabled: false,
        trigger: { type: "cron", expression: "0 2 * * *" },
        action: { type: "agent", modelId: "claude:opus-4-6", userPromptInline: "x" },
        notification: { onComplete: false, onFailure: false },
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ];

    renderSidebar("/home", projects, { automations });
    expect(await screen.findByText("disabled")).toBeInTheDocument();
  });

  it("applies sidebar-card-active class to the active automation", async () => {
    const automations = [
      {
        id: "a1",
        name: "Active auto",
        enabled: true,
        trigger: { type: "cron", expression: "0 2 * * *" },
        action: { type: "agent", modelId: "claude:opus-4-6", userPromptInline: "x" },
        notification: { onComplete: false, onFailure: false },
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ];

    renderSidebar("/automations/a1", projects, { automations });

    const autoLink = await screen.findByRole("link", { name: /Active auto/i });
    expect(autoLink.className).toContain("sidebar-card");
    expect(autoLink.className).toContain("sidebar-card-active");
  });

  it("shows green pulsing dot for running automation", async () => {
    const automations = [
      {
        id: "a1",
        name: "Running auto",
        enabled: true,
        lastRunStatus: "running",
        trigger: { type: "cron", expression: "0 2 * * *" },
        action: { type: "agent", modelId: "claude:opus-4-6", userPromptInline: "x" },
        notification: { onComplete: false, onFailure: false },
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ];

    renderSidebar("/home", projects, { automations });

    const autoLink = await screen.findByRole("link", { name: /Running auto/i });
    const dot = autoLink.querySelector("span[class*='rounded-full']");
    expect(dot).toBeTruthy();
    expect(dot!.className).toContain("bg-green-500");
    expect(dot!.className).toContain("animate-pulse");
  });

  it("shows muted dot for disabled automations", async () => {
    const automations = [
      {
        id: "a1",
        name: "Off auto",
        enabled: false,
        trigger: { type: "cron", expression: "0 2 * * *" },
        action: { type: "agent", modelId: "claude:opus-4-6", userPromptInline: "x" },
        notification: { onComplete: false, onFailure: false },
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ];

    renderSidebar("/home", projects, { automations });

    const autoLink = await screen.findByRole("link", { name: /Off auto/i });
    const dot = autoLink.querySelector("span[class*='rounded-full']");
    expect(dot).toBeTruthy();
    expect(dot!.className).toContain("bg-muted-foreground/40");
    expect(dot!.className).not.toContain("animate-pulse");
  });

  // ── SidebarSectionHeader ─────────────────────────────────────────

  it("renders 'Workspaces' section header", async () => {
    renderSidebar("/home", projects);
    expect(await screen.findByText("Workspaces")).toBeInTheDocument();
  });

  it("renders add automation button in automations header", async () => {
    const onAddAutomation = vi.fn();

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === "/api/projects") return projects;
      if (url === "/api/automations") return [];
      if (url === "/api/ui-preferences") {
        return { sidebar: { folders: [], folderOpenState: {} } };
      }
      return { committed: [], uncommitted: [] };
    });

    render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceLiveDataProvider workspaceIds={["w1"]}>
          <MemoryRouter initialEntries={["/home"]}>
            <Routes>
              <Route
                path="/home"
                element={
                  <>
                    <Sidebar onAddProject={vi.fn()} onAddAutomation={onAddAutomation} />
                    <div data-testid="location-path">/home</div>
                  </>
                }
              />
            </Routes>
          </MemoryRouter>
        </WorkspaceLiveDataProvider>
      </QueryClientProvider>,
    );

    const addBtn = await screen.findByRole("button", { name: "Add automation" });
    expect(addBtn).toBeInTheDocument();
  });

  // ── Project header owner/repo display ────────────────────────────

  it("displays owner/repo format from HTTPS GitHub URL", async () => {
    renderSidebar("/home", projects);
    expect(await screen.findByText(withTextContent("acme/alpha"))).toBeInTheDocument();
  });

  it("displays project name when URL is unparseable", async () => {
    const badUrlProjects: Project[] = [
      {
        id: "p1",
        name: "LocalProject",
        url: "just-a-name",
        createdAt: "2026-02-11T00:00:00.000Z",
        workspaces: [],
      },
    ];

    renderSidebar("/home", badUrlProjects);
    expect(await screen.findByText("LocalProject")).toBeInTheDocument();
  });

  // ── Archive redirect ─────────────────────────────────────────────

  it("navigates to /home after archiving the active workspace", async () => {
    const user = userEvent.setup();
    mockPostWithBulkFallback({
      "/api/workspaces/w1/archive": undefined,
    });

    renderSidebar("/workspaces/w1", projects, {
      diffStat: { committed: [], uncommitted: [] },
    });

    await screen.findByText("workspace/tokyo");
    await user.click(screen.getByRole("button", { name: /archive workspace/i }));

    await waitFor(() => {
      expect(screen.getByTestId("location-path")).toHaveTextContent("/home");
    });
  });
});
