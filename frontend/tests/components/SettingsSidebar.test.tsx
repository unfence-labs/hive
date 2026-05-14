import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SettingsSidebar from "@/components/SettingsSidebar";

const apiMock = vi.hoisted(() => ({
  delete: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}));

vi.mock("@/hooks/useApi", () => ({
  api: apiMock,
}));

function mockDefaultApi() {
  apiMock.get.mockImplementation((url: string) => {
    if (url === "/api/projects") {
      return Promise.resolve([
        {
          id: "p1",
          name: "Alpha",
          url: "https://github.com/acme/alpha.git",
          createdAt: "2026-02-11T00:00:00.000Z",
          workspaces: [],
        },
        {
          id: "p2",
          name: "Beta",
          url: "https://github.com/acme/beta.git",
          createdAt: "2026-02-12T00:00:00.000Z",
          workspaces: [],
        },
        {
          id: "p3",
          name: "Gamma",
          url: "https://github.com/acme/gamma.git",
          createdAt: "2026-02-13T00:00:00.000Z",
          workspaces: [],
        },
      ]);
    }

    if (url === "/api/ui-preferences") {
      return Promise.resolve({
        sidebar: {
          folders: [
            { id: "folder-1", name: "Client work", projectIds: ["p1", "p2"] },
          ],
          folderOpenState: { "folder-1": true },
        },
      });
    }

    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
}

function SettingsShell() {
  return (
    <div>
      <SettingsSidebar />
      <Outlet />
    </div>
  );
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  );
}

describe("SettingsSidebar", () => {
  beforeEach(() => {
    apiMock.delete.mockReset();
    apiMock.get.mockReset();
    apiMock.post.mockReset();
    apiMock.put.mockReset();
    mockDefaultApi();
  });

  it("keeps initial return route when navigating inside settings", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <MemoryRouter initialEntries={[{ pathname: "/settings/appearance", state: { from: "/workspaces/w1" } }]}>
        <Routes>
          <Route path="/settings" element={<SettingsShell />}>
            <Route path="appearance" element={<div>Appearance settings</div>} />
            <Route path="notifications" element={<div>Notification settings</div>} />
            <Route path="agents" element={<div>Agents settings</div>} />
            <Route path="repositories/:projectId" element={<div>Repository settings</div>} />
          </Route>
          <Route path="/workspaces/:wsId" element={<div>Workspace w1</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: /Client work/i }));
    await user.click(await screen.findByRole("link", { name: /Alpha/i }));
    await waitFor(() => {
      expect(screen.getByText("Repository settings")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => {
      expect(screen.getByText("Workspace w1")).toBeInTheDocument();
    });
  });

  it("falls back to /home when opened directly", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings/appearance"]}>
        <Routes>
          <Route path="/settings" element={<SettingsShell />}>
            <Route path="appearance" element={<div>Appearance settings</div>} />
            <Route path="notifications" element={<div>Notification settings</div>} />
            <Route path="agents" element={<div>Agents settings</div>} />
          </Route>
          <Route path="/home" element={<div>Home page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => {
      expect(screen.getByText("Home page")).toBeInTheDocument();
    });
  });

  it("navigates to notifications settings", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings/appearance"]}>
        <Routes>
          <Route path="/settings" element={<SettingsShell />}>
            <Route path="appearance" element={<div>Appearance settings</div>} />
            <Route path="notifications" element={<div>Notification settings</div>} />
            <Route path="agents" element={<div>Agents settings</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("link", { name: /Notifications/i }));
    await waitFor(() => {
      expect(screen.getByText("Notification settings")).toBeInTheDocument();
    });
  });

  it("navigates to agents settings", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings/appearance"]}>
        <Routes>
          <Route path="/settings" element={<SettingsShell />}>
            <Route path="appearance" element={<div>Appearance settings</div>} />
            <Route path="agents" element={<div>Agents settings</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("link", { name: /Agents/i }));
    await waitFor(() => {
      expect(screen.getByText("Agents settings")).toBeInTheDocument();
    });
  });

  it("highlights the agents link when agents route is active", async () => {
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings/agents"]}>
        <Routes>
          <Route path="/settings" element={<SettingsShell />}>
            <Route path="agents" element={<div>Agents settings</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText("Agents settings");
    expect(screen.getByRole("link", { name: /Agents/i })).toHaveClass("bg-primary/10");
  });

  it("groups repositories with sidebar folders in settings", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings/appearance"]}>
        <Routes>
          <Route path="/settings" element={<SettingsShell />}>
            <Route path="appearance" element={<div>Appearance settings</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const folder = await screen.findByRole("button", { name: /Client work/i });
    expect(screen.queryByRole("link", { name: /Alpha/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Beta/i })).not.toBeInTheDocument();
    await user.click(folder);
    expect(screen.getByRole("link", { name: /Alpha/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Beta/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Gamma/i })).toBeInTheDocument();
  });

  it("uses local folder expansion without persisting settings", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings/appearance"]}>
        <Routes>
          <Route path="/settings" element={<SettingsShell />}>
            <Route path="appearance" element={<div>Appearance settings</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const folder = await screen.findByRole("button", { name: /Client work/i });
    await user.click(folder);

    expect(screen.getByRole("link", { name: /Alpha/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Beta/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Gamma/i })).toBeInTheDocument();
    expect(apiMock.put).not.toHaveBeenCalled();
  });
});
