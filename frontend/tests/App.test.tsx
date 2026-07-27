import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { getConnection, replaceConnection } from "@/hooks/useConnection";

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
  createNewProjectWithWorkspace: vi.fn(),
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
    createNewProjectWithWorkspace: mocks.createNewProjectWithWorkspace,
    deleteProject: mocks.deleteProject,
    archiveWorkspace: mocks.archiveWorkspace,
  }),
}));

vi.mock("@/lib/ws-transport", () => ({
  wsTransport: {
    syncWorkspaces: mocks.syncWorkspaces,
    disconnectAll: mocks.disconnectAll,
    onMessage: mocks.onMessage,
    onReconnect: vi.fn(() => () => {}),
    onGlobalMessage: mocks.onGlobalMessage,
  },
}));

vi.mock("@/components/AddProjectDialog", () => ({
  default: ({
    open,
    onOpenChange,
    onClone,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    onClone?: (url: string) => void;
    onCreate?: (params: { name: string; visibility?: "public" | "private" }) => void;
  }) => (
    <div data-testid="add-project-dialog">
      <div data-testid="dialog-open">{String(Boolean(open))}</div>
      <button type="button" onClick={() => onOpenChange?.(false)}>
        close dialog
      </button>
      <button
        type="button"
        onClick={() => onClone?.("https://github.com/acme/new-repo.git")}
      >
        submit dialog
      </button>
    </div>
  ),
}));

vi.mock("@/pages/HomeView", () => ({
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
  default: ({
    onRefreshConnection,
    onOpenInstaller,
  }: {
    onRefreshConnection?: () => void;
    onOpenInstaller?: () => void;
  }) => (
    <>
      <button type="button" onClick={onRefreshConnection}>
        refresh connection
      </button>
      <button type="button" onClick={onOpenInstaller}>
        open installer
      </button>
    </>
  ),
}));

vi.mock("@/pages/installer/Installer", () => ({
  default: ({ onClose }: { onClose?: () => void }) => (
    <div data-testid="installer">
      {onClose && (
        <button type="button" onClick={onClose}>
          close installer
        </button>
      )}
    </div>
  ),
}));

vi.mock("@/pages/settings/NotificationSettings", () => ({
  default: () => <div>notification settings</div>,
}));

vi.mock("@/pages/settings/AgentSettings", () => ({
  default: () => <div>agent settings</div>,
}));

vi.mock("@/pages/settings/SubagentsSettings", () => ({
  default: () => <div>subagents settings</div>,
}));

vi.mock("@/pages/settings/ProjectDetail", () => ({
  default: () => <div>project detail</div>,
}));

vi.mock("@/pages/WorkspaceView", () => ({
  default: () => <div>workspace view</div>,
}));

vi.mock("@/pages/BrainView", () => ({
  default: () => <div>brain view</div>,
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

type DesktopWindow = Window & { __TAURI_INTERNALS__?: unknown };

function runInDesktopShell(): void {
  (window as DesktopWindow).__TAURI_INTERNALS__ = {};
}

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    delete (window as DesktopWindow).__TAURI_INTERNALS__;
    mocks.projects = makeProjects();
    mocks.loading = false;
    window.history.pushState({}, "", "/projects");
  });

  it("syncs unique workspace IDs and disconnects all sockets on unmount", () => {
    const { unmount } = renderApp();

    const subscribedWorkspaceIds = mocks.onMessage.mock.calls.map((call) => call[0]);
    // The Brain is always subscribed as a synthetic "brain" workspace.
    expect(new Set(subscribedWorkspaceIds)).toEqual(new Set(["brain", "w1", "w2"]));
    expect(mocks.syncWorkspaces).toHaveBeenCalledWith(["brain", "w1", "w2"]);
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

  it("renders workspace route", async () => {
    window.history.pushState({}, "", "/workspaces/w1");

    renderApp();

    expect(await screen.findByText("workspace view")).toBeInTheDocument();
  });

  it("renders brain route", async () => {
    window.history.pushState({}, "", "/brain");

    renderApp();

    expect(await screen.findByText("brain view")).toBeInTheDocument();
  });

  it("does not sync workspaces while project list is still loading", () => {
    mocks.loading = true;

    renderApp();

    expect(mocks.syncWorkspaces).not.toHaveBeenCalled();
  });

  it("syncs only the Brain workspace when there are no projects", () => {
    mocks.projects = [];

    renderApp();

    expect(mocks.syncWorkspaces).toHaveBeenCalledWith(["brain"]);
    // Brain is still subscribed for cache invalidation even with no projects.
    expect(mocks.onMessage).toHaveBeenCalledWith("brain", expect.any(Function));
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

    await user.click(await screen.findByRole("button", { name: "layout add project" }));
    expect(screen.getByTestId("dialog-open")).toHaveTextContent("true");
  });

  it("refreshes backend connection from settings route", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "", "/settings/connection");
    renderApp();

    await user.click(await screen.findByRole("button", { name: "refresh connection" }));

    expect(mocks.disconnectAll).toHaveBeenCalledTimes(1);
    expect(mocks.fetchProjects).toHaveBeenCalledTimes(1);
  });

  it("renders notification settings route", () => {
    window.history.pushState({}, "", "/settings/notifications");

    renderApp();

    expect(screen.getByText("notification settings")).toBeInTheDocument();
  });

  it("renders CLI settings route", async () => {
    window.history.pushState({}, "", "/settings/cli");

    renderApp();

    expect(await screen.findByText("agent settings")).toBeInTheDocument();
  });

  it("renders subagents settings route", async () => {
    window.history.pushState({}, "", "/settings/subagents");

    renderApp();

    expect(await screen.findByText("subagents settings")).toBeInTheDocument();
  });

  it("redirects /projects/:id to /home", () => {
    window.history.pushState({}, "", "/projects/p1");

    renderApp();

    expect(screen.getByRole("button", { name: "open add project" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/home");
  });

  it("redirects /settings to /settings/appearance", async () => {
    window.history.pushState({}, "", "/settings");

    renderApp();

    expect(await screen.findByText("appearance settings")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/settings/appearance");
  });

  it("redirects /automations to /home", () => {
    window.history.pushState({}, "", "/automations");

    renderApp();

    expect(screen.getByRole("button", { name: "open add project" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/home");
  });

  it("opens the installer in the desktop shell when no server is configured", async () => {
    runInDesktopShell();

    renderApp();

    expect(await screen.findByTestId("installer")).toBeInTheDocument();
    // A layer in front of the app, not a variant of it: the app is still there.
    expect(screen.getByTestId("app-layout")).toBeInTheDocument();
    // With no server there is no way out but the welcome screen's own paths.
    expect(screen.queryByRole("button", { name: "close installer" })).not.toBeInTheDocument();
  });

  it("leaves the web build alone when no server is configured", () => {
    renderApp();

    expect(screen.queryByTestId("installer")).not.toBeInTheDocument();
  });

  it("does not open the installer once a server is configured", () => {
    runInDesktopShell();
    replaceConnection({ host: "100.64.0.10", port: 9420 });

    renderApp();

    expect(screen.queryByTestId("installer")).not.toBeInTheDocument();
  });

  it("opens the installer on demand from Settings, and closing it changes nothing", async () => {
    const user = userEvent.setup();
    runInDesktopShell();
    replaceConnection({ host: "100.64.0.10", port: 9420, authToken: "tok" });
    window.history.pushState({}, "", "/settings/connection");
    renderApp();

    await user.click(await screen.findByRole("button", { name: "open installer" }));
    expect(await screen.findByTestId("installer")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "close installer" }));

    expect(screen.queryByTestId("installer")).not.toBeInTheDocument();
    expect(getConnection()).toMatchObject({ host: "100.64.0.10", port: 9420, authToken: "tok" });
  });

  it("redirects /projects to /home", () => {
    window.history.pushState({}, "", "/projects");

    renderApp();

    expect(screen.getByRole("button", { name: "open add project" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/home");
  });
});
