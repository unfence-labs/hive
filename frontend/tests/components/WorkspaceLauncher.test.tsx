import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import WorkspaceLauncher from "@/components/WorkspaceLauncher";
import type { Project } from "@/types";

const { apiGet, apiPost } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock("@/hooks/useApi", () => ({
  api: { get: apiGet, post: apiPost, put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

const singleProject: Project[] = [
  { id: "p1", name: "hive", createdAt: "2026-01-01T00:00:00.000Z", workspaces: [] },
];

function renderLauncher(projects: Project[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(["projects"], projects);
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <WorkspaceLauncher />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function pressShortcut(key: string, shiftKey = false) {
  fireEvent.keyDown(window, { key, metaKey: true, shiftKey });
}

describe("WorkspaceLauncher", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiGet.mockResolvedValue([]);
  });

  it("opens the spotlight on Cmd+K with both workspace actions", async () => {
    renderLauncher(singleProject);
    pressShortcut("k");

    expect(await screen.findByText("Workspace actions")).toBeInTheDocument();
    expect(screen.getByText("New workspace")).toBeInTheDocument();
    expect(screen.getByText("New workspace from…")).toBeInTheDocument();
  });

  it("creates a workspace instantly on Cmd+N when the project is unambiguous", async () => {
    apiPost.mockResolvedValue({ id: "ws-new", name: "nantes" });
    renderLauncher(singleProject);
    pressShortcut("n");

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith("/api/projects/p1/workspaces");
    });
  });

  it("opens the picker on Cmd+Shift+N", async () => {
    renderLauncher(singleProject);
    pressShortcut("N", true);

    expect(await screen.findByPlaceholderText("Search by title, number, or author")).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("asks only for the project on Cmd+N when it is ambiguous, then creates from main", async () => {
    apiPost.mockResolvedValue({ id: "ws-new", name: "nantes" });
    renderLauncher([
      ...singleProject,
      { id: "p2", name: "other", createdAt: "2026-01-01T00:00:00.000Z", workspaces: [] },
    ]);
    pressShortcut("n");

    // Project chooser, not the full "from…" picker with source tabs.
    expect(
      await screen.findByPlaceholderText("Choose a project for the new workspace…"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Branches" })).not.toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("other"));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith("/api/projects/p2/workspaces");
    });
  });
});
