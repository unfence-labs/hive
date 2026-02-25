import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AppLayout from "@/components/AppLayout";

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: vi.fn().mockResolvedValue([]),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@/components/Sidebar", () => ({
  default: () => <div data-testid="sidebar">Sidebar</div>,
}));

function renderLayout(initialEntry = "/workspaces/ws-1") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route
            element={<AppLayout onAddProject={vi.fn()} />}
          >
            <Route path="/workspaces/:wsId" element={<div data-testid="workspace-content">workspace</div>} />
            <Route path="/settings/appearance" element={<div data-testid="settings-content">settings</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AppLayout", () => {
  it("renders sidebar and workspace content", async () => {
    renderLayout();
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-content")).toBeInTheDocument();
  });

  it("renders sidebar and settings content", async () => {
    renderLayout("/settings/appearance");
    await screen.findByTestId("settings-content");
    expect(screen.getByTestId("settings-content")).toBeInTheDocument();
  });
});
