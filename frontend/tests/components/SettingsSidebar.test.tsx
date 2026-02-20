import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SettingsSidebar from "@/components/SettingsSidebar";

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: vi.fn().mockResolvedValue([
      {
        id: "p1",
        name: "Alpha",
        url: "https://github.com/acme/alpha.git",
        createdAt: "2026-02-11T00:00:00.000Z",
        workspaces: [],
      },
    ]),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

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
  it("keeps initial return route when navigating inside settings", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <MemoryRouter initialEntries={[{ pathname: "/settings/appearance", state: { from: "/workspaces/w1" } }]}>
        <Routes>
          <Route path="/settings" element={<SettingsShell />}>
            <Route path="appearance" element={<div>Appearance settings</div>} />
            <Route path="notifications" element={<div>Notification settings</div>} />
            <Route path="repositories/:projectId" element={<div>Repository settings</div>} />
          </Route>
          <Route path="/workspaces/:wsId" element={<div>Workspace w1</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("link", { name: /Alpha/i }));
    await waitFor(() => {
      expect(screen.getByText("Repository settings")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => {
      expect(screen.getByText("Workspace w1")).toBeInTheDocument();
    });
  });

  it("falls back to /projects when opened directly", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings/appearance"]}>
        <Routes>
          <Route path="/settings" element={<SettingsShell />}>
            <Route path="appearance" element={<div>Appearance settings</div>} />
            <Route path="notifications" element={<div>Notification settings</div>} />
          </Route>
          <Route path="/projects" element={<div>Projects list</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => {
      expect(screen.getByText("Projects list")).toBeInTheDocument();
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
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("link", { name: /Notifications/i }));
    await waitFor(() => {
      expect(screen.getByText("Notification settings")).toBeInTheDocument();
    });
  });
});
