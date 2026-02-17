import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";

const mocks = vi.hoisted(() => ({
  fetchProjects: vi.fn(),
  createWorkspace: vi.fn(),
  createProjectWithWorkspace: vi.fn(),
  deleteProject: vi.fn(),
  archiveWorkspace: vi.fn(),
  syncWorkspaces: vi.fn(),
  disconnectAll: vi.fn(),
}));

vi.mock("@/hooks/useProjects", () => ({
  useProjects: () => ({
    projects: [
      {
        id: "p1",
        name: "project-1",
        url: "https://github.com/acme/repo.git",
        createdAt: "2026-02-12T00:00:00.000Z",
        workspaces: [
          { id: "w1", name: "w1", branch: "workspace/w1", status: "idle", createdAt: "2026-02-12T00:00:00.000Z" },
          { id: "w1", name: "w1-duplicate", branch: "workspace/w1", status: "idle", createdAt: "2026-02-12T00:00:00.000Z" },
          { id: "w2", name: "w2", branch: "workspace/w2", status: "idle", createdAt: "2026-02-12T00:00:00.000Z" },
        ],
      },
    ],
    loading: false,
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
  },
}));

vi.mock("@/components/AddProjectDialog", () => ({
  default: () => <div data-testid="add-project-dialog" />,
}));

vi.mock("@/components/EmptyStateLogo", () => ({
  default: ({ onAddProject }: { onAddProject?: () => void }) => (
    <button type="button" onClick={onAddProject}>
      open add project
    </button>
  ),
}));

vi.mock("@/pages/SettingsView", () => ({
  default: ({ onRefreshConnection }: { onRefreshConnection?: () => void }) => (
    <button type="button" onClick={onRefreshConnection}>
      refresh connection
    </button>
  ),
}));

vi.mock("@/pages/WorkspaceView", () => ({
  default: () => <div>workspace view</div>,
}));

vi.mock("@/pages/LogoSquareTempPage", () => ({
  default: () => <div>logo page</div>,
}));

vi.mock("@/components/AppLayout", async () => {
  const { Outlet } = await import("react-router-dom");
  return {
    default: () => (
      <div data-testid="app-layout">
        <Outlet />
      </div>
    ),
  };
});

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, "", "/projects");
  });

  it("syncs unique workspace IDs and disconnects all sockets on unmount", () => {
    const { unmount } = render(<App />);

    expect(mocks.syncWorkspaces).toHaveBeenCalledWith(["w1", "w2"]);
    expect(mocks.disconnectAll).not.toHaveBeenCalled();

    unmount();
    expect(mocks.disconnectAll).toHaveBeenCalledTimes(1);
  });

  it("refreshes backend connection from settings route", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "", "/settings");
    render(<App />);

    await user.click(screen.getByRole("button", { name: "refresh connection" }));

    expect(mocks.disconnectAll).toHaveBeenCalledTimes(1);
    expect(mocks.fetchProjects).toHaveBeenCalledTimes(1);
  });
});
