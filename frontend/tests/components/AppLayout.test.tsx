import { render, screen } from "@testing-library/react";
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AppLayout from "@/components/AppLayout";

vi.mock("react-resizable-panels", () => {
  const React = require("react");
  return {
    Group: ({ children, style, className }: any) => React.createElement("div", { style, className }, children),
    Panel: ({ children, style, className }: any) => React.createElement("div", { style, className }, children),
    Separator: ({ className }: any) => React.createElement("div", { className }),
    usePanelRef: () => ({ current: { collapse: () => {}, expand: () => {}, isCollapsed: () => false } }),
    useDefaultLayout: () => ({ defaultLayout: undefined, onLayoutChanged: () => {} }),
  };
});

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

function renderLayout(
  initialEntry = "/workspaces/ws-1",
  workspaceElement: ReactNode = <div data-testid="workspace-content">workspace</div>,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Suspense fallback={null}>
          <Routes>
            <Route
              element={<AppLayout onAddProject={vi.fn()} />}
            >
              <Route path="/workspaces/:wsId" element={workspaceElement} />
              <Route path="/settings/appearance" element={<div data-testid="settings-content">settings</div>} />
            </Route>
          </Routes>
        </Suspense>
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

  it("keeps the shell visible while a lazy route is loading", () => {
    const PendingRoute = lazy(
      () => new Promise<{ default: ComponentType }>(() => {}),
    );

    renderLayout("/workspaces/ws-1", <PendingRoute />);

    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });
});
