import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  onMessage: vi.fn(() => ({
    unsubscribe: vi.fn(),
    hadBufferedMessages: false,
  })),
  onGlobalMessage: vi.fn(() => vi.fn()),
  useDesktopUpdate: vi.fn(),
  compatibility: {
    phase: "ready",
    appVersion: "1.2.3",
    server: { version: "1.2.3", updateMethod: "provisioner" },
    serverIdentity: "server",
  } as {
    phase: string;
    error?: string;
    appVersion: string;
    server: { version: string; updateMethod: string };
    serverIdentity: string;
  },
  update: { phase: "idle" } as {
    phase: string;
    version?: string;
    step?: string;
  },
  compatibilityCurrent: true,
  refreshCompatibility: vi.fn(),
  setBusyWorkspaces: vi.fn(),
  subscribeStatus: vi.fn(() => vi.fn()),
  getStatus: vi.fn(() => "disconnected"),
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
        {
          id: "w1",
          name: "w1",
          branch: "workspace/w1",
          status: "idle" as const,
          createdAt: "2026-02-12T00:00:00.000Z",
        },
        {
          id: "w1",
          name: "w1-duplicate",
          branch: "workspace/w1",
          status: "idle" as const,
          createdAt: "2026-02-12T00:00:00.000Z",
        },
        {
          id: "w2",
          name: "w2",
          branch: "workspace/w2",
          status: "idle" as const,
          createdAt: "2026-02-12T00:00:00.000Z",
        },
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

vi.mock("@/hooks/useDesktopUpdate", () => ({
  useDesktopUpdate: mocks.useDesktopUpdate,
  shouldCheckForUpdates: () =>
    Boolean((window as DesktopWindow).__TAURI_INTERNALS__) &&
    import.meta.env.PROD,
  useDesktopUpdateState: () => mocks.update,
  useServerCompatibility: () => mocks.compatibility,
  serverCompatibilityMatchesConnection: () => mocks.compatibilityCurrent,
  refreshServerCompatibility: mocks.refreshCompatibility,
  invalidateServerCompatibility: vi.fn(),
  desktopUpdateInProgress: () => mocks.update.phase === "updatingServer",
  compareVersions: (a: string, b: string) => a.localeCompare(b),
  setUpdateBusyWorkspaces: mocks.setBusyWorkspaces,
  checkForUpdatesNow: vi.fn(),
  installCurrentUpdate: vi.fn(),
  respondToUpdate: vi.fn(),
  dismissUpdateInput: vi.fn(),
}));

vi.mock("@/lib/ws-transport", () => ({
  wsTransport: {
    syncWorkspaces: mocks.syncWorkspaces,
    subscribe: mocks.subscribeStatus,
    getStatus: mocks.getStatus,
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
    onCreate?: (params: {
      name: string;
      visibility?: "public" | "private";
    }) => void;
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
  default: ({ onRefreshConnection }: { onRefreshConnection?: () => void }) => (
    <button type="button" onClick={onRefreshConnection}>
      refresh connection
    </button>
  ),
}));

vi.mock("@/pages/settings/ServerSettings", () => ({
  default: ({ onOpenInstaller }: { onOpenInstaller: () => void }) => (
    <button type="button" onClick={onOpenInstaller}>
      open installer
    </button>
  ),
}));

vi.mock("@/pages/installer/Installer", async () => {
  const { completeConnectionSetup, replaceConnection: store } =
    await import("@/hooks/useConnection");
  return {
    default: ({
      onClose,
      cancellable,
    }: {
      onClose?: () => void;
      cancellable?: boolean;
    }) => (
      <div data-testid="installer">
        <button type="button" onClick={onClose}>
          close installer
        </button>
        {cancellable && (
          <button type="button" onClick={onClose}>
            cancel installer
          </button>
        )}
        {/* Stands in for the install storing the connection it just created. */}
        <button
          type="button"
          onClick={() =>
            store({
              host: "203.0.113.10",
              port: 9420,
              authToken: "issued",
              sshUser: "hive",
              setupPending: true,
            })
          }
        >
          store connection
        </button>
        <button
          type="button"
          onClick={() => {
            completeConnectionSetup();
            onClose?.();
          }}
        >
          complete setup
        </button>
      </div>
    ),
  };
});

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
    AppShell: ({ sidebar }: { sidebar: React.ReactNode }) => (
      <div data-testid="app-shell">{sidebar}<Outlet /></div>
    ),
    SettingsHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
    mocks.getStatus.mockReturnValue("disconnected");
    mocks.compatibilityCurrent = true;
    mocks.compatibility = {
      phase: "ready",
      appVersion: "1.2.3",
      server: { version: "1.2.3", updateMethod: "provisioner" },
      serverIdentity: "server",
    };
    mocks.update = { phase: "idle" };
    localStorage.clear();
    delete (window as DesktopWindow).__TAURI_INTERNALS__;
    // Most tests exercise the configured app; the boot gate has its own tests,
    // which clear this again.
    replaceConnection({ host: "100.64.0.10", port: 9420, authToken: "tok" });
    mocks.projects = makeProjects();
    mocks.loading = false;
    window.history.pushState({}, "", "/projects");
  });

  it("syncs unique workspace IDs and disconnects all sockets on unmount", () => {
    const { unmount } = renderApp();

    const subscribedWorkspaceIds = mocks.onMessage.mock.calls.map(
      (call) => call[0],
    );
    // The Brain is always subscribed as a synthetic "brain" workspace.
    expect(new Set(subscribedWorkspaceIds)).toEqual(
      new Set(["brain", "w1", "w2"]),
    );
    expect(mocks.syncWorkspaces).toHaveBeenCalledWith(["brain", "w1", "w2"]);
    expect(mocks.disconnectAll).not.toHaveBeenCalled();

    unmount();
    expect(mocks.disconnectAll).toHaveBeenCalledTimes(1);
  });

  it("keeps busy state unknown until every workspace and the Brain have bootstrapped", () => {
    renderApp();
    expect(mocks.setBusyWorkspaces).toHaveBeenLastCalledWith(null);
    const emitStatus = (id: string, status: "idle" | "busy") => {
      act(() => {
        for (const [workspaceId, handler] of mocks.onMessage.mock.calls) {
          if (workspaceId === id) handler({ type: "status", status });
        }
      });
    };
    emitStatus("w1", "idle");
    emitStatus("w2", "idle");
    expect(mocks.setBusyWorkspaces).toHaveBeenLastCalledWith(null);
    emitStatus("brain", "busy");
    expect(mocks.setBusyWorkspaces).toHaveBeenLastCalledWith(1);
    emitStatus("brain", "idle");
    expect(mocks.setBusyWorkspaces).toHaveBeenLastCalledWith(0);
  });

  it("rechecks compatibility when the workspace hub reconnects", () => {
    renderApp();
    mocks.getStatus.mockReturnValue("connected");
    const listener = mocks.subscribeStatus.mock.calls[0]?.[1];
    act(() => listener?.());
    expect(mocks.refreshCompatibility).toHaveBeenCalledOnce();
  });

  it("redirects root index to /home", () => {
    window.history.pushState({}, "", "/");

    renderApp();

    expect(
      screen.getByRole("button", { name: "open add project" }),
    ).toBeInTheDocument();
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

    await user.click(
      await screen.findByRole("button", { name: "layout add project" }),
    );
    expect(screen.getByTestId("dialog-open")).toHaveTextContent("true");
  });

  it("refreshes backend connection from settings route", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "", "/settings/connection");
    renderApp();

    await user.click(
      await screen.findByRole("button", { name: "refresh connection" }),
    );

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

    expect(
      screen.getByRole("button", { name: "open add project" }),
    ).toBeInTheDocument();
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

    expect(
      screen.getByRole("button", { name: "open add project" }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/home");
  });

  it("boots on the installer alone when no server is configured", async () => {
    replaceConnection(null);
    runInDesktopShell();

    renderApp();

    expect(await screen.findByTestId("installer")).toBeInTheDocument();
    // The gate: nothing else mounts, so nothing calls a server that is not
    // there. No layout, no routes, no dialogs.
    expect(screen.queryByTestId("app-layout")).not.toBeInTheDocument();
    expect(mocks.syncWorkspaces).not.toHaveBeenCalled();
    // With no server there is no way out but the welcome screen's own paths.
    expect(
      screen.queryByRole("button", { name: "cancel installer" }),
    ).not.toBeInTheDocument();
    expect(mocks.useDesktopUpdate).toHaveBeenLastCalledWith(false);
  });

  it("keeps the gate up once the install stores its connection", async () => {
    const user = userEvent.setup();
    replaceConnection(null);
    runInDesktopShell();
    renderApp();

    await user.click(
      await screen.findByRole("button", { name: "store connection" }),
    );

    // The install stores the connection partway through: the final screen —
    // connect your accounts — still has to run on the server it just built,
    // and the app must not start bootstrapping underneath it.
    expect(screen.getByTestId("installer")).toBeInTheDocument();
    expect(screen.queryByTestId("app-layout")).not.toBeInTheDocument();
    // A gate is not an overlay: there is still nothing to abandon it for.
    expect(
      screen.queryByRole("button", { name: "cancel installer" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "complete setup" }));
    expect(screen.queryByTestId("installer")).not.toBeInTheDocument();
    // The configured app mounts for the first time now.
    expect(await screen.findByTestId("app-layout")).toBeInTheDocument();
    expect(getConnection()).not.toHaveProperty("setupPending");
  });

  it("gates the web build too, offering the connect path", async () => {
    replaceConnection(null);

    renderApp();

    expect(await screen.findByTestId("installer")).toBeInTheDocument();
    expect(screen.queryByTestId("app-layout")).not.toBeInTheDocument();
  });

  it("does not open the installer once a server is configured", () => {
    runInDesktopShell();
    replaceConnection({ host: "100.64.0.10", port: 9420 });

    renderApp();

    expect(screen.queryByTestId("installer")).not.toBeInTheDocument();
  });

  it("boots on the installer alone while guided setup is pending", async () => {
    runInDesktopShell();
    replaceConnection({
      host: "100.64.0.10",
      port: 9420,
      authToken: "tok",
      sshUser: "hive",
      setupPending: true,
    });

    renderApp();

    expect(await screen.findByTestId("installer")).toBeInTheDocument();
    expect(screen.queryByTestId("app-layout")).not.toBeInTheDocument();
    expect(mocks.syncWorkspaces).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "cancel installer" }),
    ).not.toBeInTheDocument();
  });

  it("opens the installer on demand from Settings, and closing it changes nothing", async () => {
    const user = userEvent.setup();
    runInDesktopShell();
    replaceConnection({ host: "100.64.0.10", port: 9420, authToken: "tok" });
    window.history.pushState({}, "", "/settings/server");
    renderApp();

    await user.click(
      await screen.findByRole("button", { name: "open installer" }),
    );
    expect(await screen.findByTestId("installer")).toBeInTheDocument();
    // Reopened over a configured app it is an overlay, not the gate: the app
    // stays mounted and abandoning is offered.
    expect(screen.getByTestId("app-layout")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "cancel installer" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "close installer" }));

    expect(screen.queryByTestId("installer")).not.toBeInTheDocument();
    expect(getConnection()).toMatchObject({
      host: "100.64.0.10",
      port: 9420,
      authToken: "tok",
    });
  });

  it("does not register the server settings route in the web build", () => {
    replaceConnection({ host: "100.64.0.10", port: 9420 });
    window.history.pushState({}, "", "/settings/server");

    renderApp();

    expect(
      screen.queryByRole("button", { name: "open installer" }),
    ).not.toBeInTheDocument();
  });

  it("redirects /projects to /home", () => {
    window.history.pushState({}, "", "/projects");

    renderApp();

    expect(
      screen.getByRole("button", { name: "open add project" }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/home");
  });
});

afterEach(() => vi.unstubAllEnvs());

describe("production desktop compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStatus.mockReturnValue("disconnected");
    mocks.compatibilityCurrent = true;
    vi.stubEnv("PROD", true);
    runInDesktopShell();
    replaceConnection({ host: "100.64.0.10", port: 9420, authToken: "tok" });
    window.history.pushState({}, "", "/workspaces/w1");
    mocks.compatibility = {
      phase: "ready",
      appVersion: "1.2.3",
      server: { version: "1.3.0", updateMethod: "provisioner" },
      serverIdentity: "server",
    };
    mocks.update = { phase: "available", version: "1.3.0" };
  });
  it("blocks workspace mounting on a version mismatch", () => {
    renderApp();
    expect(
      screen.getByRole("heading", { name: "Update required" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("app-layout")).not.toBeInTheDocument();
    expect(screen.getByTestId("app-shell")).toBeInTheDocument();
    expect(screen.getByText("Appearance")).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("link", { name: "Appearance" })).not.toBeInTheDocument();
    expect(mocks.syncWorkspaces).not.toHaveBeenCalled();
  });
  it("rejects matching versions verified against a previous connection or access token", () => {
    mocks.compatibility.server.version = "1.2.3";
    mocks.compatibilityCurrent = false;
    renderApp();
    expect(screen.queryByTestId("app-layout")).not.toBeInTheDocument();
    expect(mocks.syncWorkspaces).not.toHaveBeenCalled();
  });
  it("keeps connection settings accessible while blocked", async () => {
    renderApp();
    await userEvent.click(
      screen.getByRole("link", { name: "Connection" }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "refresh connection" }),
    );
    expect(mocks.refreshCompatibility).toHaveBeenCalledOnce();
    expect(mocks.fetchProjects).not.toHaveBeenCalled();
  });
  it("rechecks compatibility instead of refreshing the old workspace after a connection change", async () => {
    mocks.compatibility.server.version = "1.2.3";
    mocks.update = { phase: "idle" };
    window.history.pushState({}, "", "/settings/connection");
    renderApp();
    await userEvent.click(
      await screen.findByRole("button", { name: "refresh connection" }),
    );
    expect(mocks.refreshCompatibility).toHaveBeenCalledOnce();
    expect(mocks.fetchProjects).not.toHaveBeenCalled();
  });
  it("shows a simple unavailable state", () => {
    mocks.compatibility.phase = "unavailable";
    mocks.update = { phase: "idle" };
    renderApp();
    expect(
      screen.getByRole("heading", { name: "Server unavailable" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
  it("shows the reason a compatibility check failed", () => {
    mocks.compatibility.phase = "unavailable";
    mocks.compatibility.error = "Unsupported release version: next";
    mocks.update = { phase: "idle" };
    renderApp();
    expect(screen.getByRole("alert")).toHaveTextContent("Unsupported release version: next");
  });
  it("keeps progress visible during the server restart", () => {
    mocks.compatibility.phase = "unavailable";
    mocks.update = {
      phase: "updatingServer",
      version: "1.3.0",
      step: "Restarting",
    };
    renderApp();
    expect(screen.getByRole("status")).toHaveTextContent("Restarting");
    expect(screen.queryByText("Server unavailable")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Connection" }),
    ).not.toBeInTheDocument();
  });
  it("mounts the workspace after matching versions are verified", async () => {
    mocks.compatibility.server.version = "1.2.3";
    mocks.update = { phase: "completed" };
    renderApp();
    expect(await screen.findByText("workspace view")).toBeInTheDocument();
  });
  it("does not block development builds", async () => {
    vi.stubEnv("PROD", false);
    renderApp();
    expect(await screen.findByText("workspace view")).toBeInTheDocument();
  });
});
