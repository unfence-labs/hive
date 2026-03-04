import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

const mocks = vi.hoisted(() => ({
  fetchProjects: vi.fn(),
  createWorkspace: vi.fn(),
  createProjectWithWorkspace: vi.fn(),
  deleteProject: vi.fn(),
  archiveWorkspace: vi.fn(),
  syncWorkspaces: vi.fn(),
  disconnectAll: vi.fn(),
  onMessage: vi.fn(() => ({ unsubscribe: vi.fn(), hadBufferedMessages: false })),
  onGlobalMessage: vi.fn(() => vi.fn()),
  projects: [] as Array<{
    id: string;
    name: string;
    url: string;
    createdAt: string;
    workspaces: Array<{
      id: string;
      name: string;
      branch: string;
      status: "idle" | "busy";
      createdAt: string;
    }>;
  }>,
  loading: false,
}));

function makeProjects() {
  return [
    {
      id: "p1",
      name: "project-1",
      url: "https://github.com/acme/repo.git",
      createdAt: "2026-02-12T00:00:00.000Z",
      workspaces: [
        { id: "w1", name: "w1", branch: "workspace/w1", status: "idle" as const, createdAt: "2026-02-12T00:00:00.000Z" },
        { id: "w1", name: "w1-duplicate", branch: "workspace/w1", status: "idle" as const, createdAt: "2026-02-12T00:00:00.000Z" },
        { id: "w2", name: "w2", branch: "workspace/w2", status: "idle" as const, createdAt: "2026-02-12T00:00:00.000Z" },
      ],
    },
  ];
}

vi.mock("@/hooks/useProjects", () => ({
  useProjects: () => ({
    projects: mocks.projects,
    loading: mocks.loading,
    fetchProjects: mocks.fetchProjects,
    createWorkspace: mocks.createWorkspace,
    createProjectWithWorkspace: mocks.createProjectWithWorkspace,
    deleteProject: mocks.deleteProject,
    archiveWorkspace: mocks.archiveWorkspace,
  }),
}));

vi.mock("@/lib/ws-transport", () => ({
  wsTransport: {
    syncWorkspaces: mocks.syncWorkspaces,
    disconnectAll: mocks.disconnectAll,
    onMessage: mocks.onMessage,
    onGlobalMessage: mocks.onGlobalMessage,
  },
}));

vi.mock("@/components/AddProjectDialog", () => ({
  default: ({
    open,
    onOpenChange,
    onSubmit,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    onSubmit?: (url: string) => void;
  }) => (
    <div data-testid="add-project-dialog">
      <div data-testid="dialog-open">{String(Boolean(open))}</div>
      <button type="button" onClick={() => onOpenChange?.(false)}>
        close dialog
      </button>
      <button
        type="button"
        onClick={() => onSubmit?.("https://github.com/acme/new-repo.git")}
      >
        submit dialog
      </button>
    </div>
  ),
}));

vi.mock("@/components/EmptyStateLogo", () => ({
  default: ({ onAddProject }: { onAddProject?: () => void }) => (
    <button type="button" onClick={onAddProject}>
      open add project
    </button>
  ),
}));

vi.mock("@/pages/settings/AppearanceSettings", () => ({
  default: () => <div>appearance settings</div>,
}));

vi.mock("@/pages/settings/ConnectionSettings", () => ({
  default: ({ onRefreshConnection }: { onRefreshConnection?: () => void }) => (
    <button type="button" onClick={onRefreshConnection}>
      refresh connection
    </button>
  ),
}));

vi.mock("@/pages/settings/NotificationSettings", () => ({
  default: () => <div>notification settings</div>,
}));

vi.mock("@/pages/settings/AgentSettings", () => ({
  default: () => <div>agent settings</div>,
}));

vi.mock("@/pages/settings/ProjectDetail", () => ({
  default: () => <div>project detail</div>,
}));

vi.mock("@/pages/WorkspaceView", () => ({
  default: () => <div>workspace view</div>,
}));

vi.mock("@/components/AppLayout", async () => {
  const { Outlet } = await import("react-router-dom");
  return {
    default: ({ onAddProject }: { onAddProject?: () => void }) => (
      <div data-testid="app-layout">
        <button type="button" onClick={onAddProject}>
          layout add project
        </button>
        <Outlet />
      </div>
    ),
  };
});

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.projects = makeProjects();
    mocks.loading = false;
    window.history.pushState({}, "", "/projects");
  });

  it("syncs unique workspace IDs and disconnects all sockets on unmount", () => {
    const { unmount } = renderApp();

    const subscribedWorkspaceIds = mocks.onMessage.mock.calls.map((call) => call[0]);
    expect(new Set(subscribedWorkspaceIds)).toEqual(new Set(["w1", "w2"]));
    expect(mocks.syncWorkspaces).toHaveBeenCalledWith(["w1", "w2"]);
    expect(mocks.disconnectAll).not.toHaveBeenCalled();

    unmount();
    expect(mocks.disconnectAll).toHaveBeenCalledTimes(1);
  });

  it("redirects root index to /home", () => {
    window.history.pushState({}, "", "/");

    renderApp();

    expect(screen.getByRole("button", { name: "open add project" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/home");
  });

  it("renders workspace route", () => {
    window.history.pushState({}, "", "/workspaces/w1");

    renderApp();

    expect(screen.getByText("workspace view")).toBeInTheDocument();
  });

  it("does not sync workspaces while project list is still loading", () => {
    mocks.loading = true;

    renderApp();

    expect(mocks.syncWorkspaces).not.toHaveBeenCalled();
  });

  it("syncs an empty workspace list when there are no projects", () => {
    mocks.projects = [];

    renderApp();

    expect(mocks.syncWorkspaces).toHaveBeenCalledWith([]);
    expect(mocks.onMessage).not.toHaveBeenCalled();
  });

  it("opens add-project dialog from empty state and submits project creation", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "", "/projects");
    renderApp();

    expect(screen.getByTestId("dialog-open")).toHaveTextContent("false");

    await user.click(screen.getByRole("button", { name: "open add project" }));
    expect(screen.getByTestId("dialog-open")).toHaveTextContent("true");

    await user.click(screen.getByRole("button", { name: "submit dialog" }));
    expect(mocks.createProjectWithWorkspace).toHaveBeenCalledWith(
      "https://github.com/acme/new-repo.git",
    );
  });

  it("opens add-project dialog from layout action", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "", "/settings/appearance");
    renderApp();

    expect(screen.getByTestId("dialog-open")).toHaveTextContent("false");

    await user.click(screen.getByRole("button", { name: "layout add project" }));
    expect(screen.getByTestId("dialog-open")).toHaveTextContent("true");
  });

  it("refreshes backend connection from settings route", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "", "/settings/connection");
    renderApp();

    await user.click(screen.getByRole("button", { name: "refresh connection" }));

    expect(mocks.disconnectAll).toHaveBeenCalledTimes(1);
    expect(mocks.fetchProjects).toHaveBeenCalledTimes(1);
  });

  it("renders notification settings route", () => {
    window.history.pushState({}, "", "/settings/notifications");

    renderApp();

    expect(screen.getByText("notification settings")).toBeInTheDocument();
  });

  it("renders agent settings route", () => {
    window.history.pushState({}, "", "/settings/agents");

    renderApp();

    expect(screen.getByText("agent settings")).toBeInTheDocument();
  });

  it("redirects /projects/:id to /home", () => {
    window.history.pushState({}, "", "/projects/p1");

    renderApp();

    expect(screen.getByRole("button", { name: "open add project" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/home");
  });

  it("redirects /settings to /settings/appearance", () => {
    window.history.pushState({}, "", "/settings");

    renderApp();

    expect(screen.getByText("appearance settings")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/settings/appearance");
  });

  it("redirects /automations to /home", () => {
    window.history.pushState({}, "", "/automations");

    renderApp();

    expect(screen.getByRole("button", { name: "open add project" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/home");
  });

  it("redirects /projects to /home", () => {
    window.history.pushState({}, "", "/projects");

    renderApp();

    expect(screen.getByRole("button", { name: "open add project" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/home");
  });
});
