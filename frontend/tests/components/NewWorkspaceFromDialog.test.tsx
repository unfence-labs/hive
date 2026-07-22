import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import NewWorkspaceFromDialog from "@/components/NewWorkspaceFromDialog";
import type { Project } from "@/types";

const { apiGet, apiPost } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock("@/hooks/useApi", () => ({
  api: { get: apiGet, post: apiPost, put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

const projects: Project[] = [
  {
    id: "p1",
    name: "hive",
    createdAt: "2026-01-01T00:00:00.000Z",
    workspaces: [],
  },
  {
    id: "p2",
    name: "other",
    createdAt: "2026-01-01T00:00:00.000Z",
    workspaces: [],
  },
];

function mockSourceRoutes() {
  apiGet.mockImplementation((url: string) => {
    if (url === "/api/projects") return Promise.resolve(projects);
    if (url === "/api/projects/p1/pulls") {
      return Promise.resolve({
        pulls: [
          { number: 12, title: "Fix streaming", branch: "fix/stream", url: "u", isDraft: false, author: "flo" },
          { number: 13, title: "Docs pass", branch: "docs", url: "u", isDraft: true, author: "sam", workspaceId: "ws-1", workspaceName: "lyon" },
        ],
      });
    }
    if (url === "/api/projects/p1/branches") {
      return Promise.resolve({
        branches: [
          { name: "fix/stream", localOnly: true },
          { name: "feat/picker" },
          { name: "wip/ui", workspaceId: "ws-1", workspaceName: "lyon" },
        ],
      });
    }
    if (url === "/api/projects/p1/issues") {
      return Promise.resolve({ issues: [{ number: 45, title: "Sidebar flickers", url: "u", author: "flo" }] });
    }
    return Promise.resolve({});
  });
}

function renderDialog(onOpenChange = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(["projects"], projects);
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <NewWorkspaceFromDialog open onOpenChange={onOpenChange} defaultProjectId="p1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

describe("NewWorkspaceFromDialog", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    mockSourceRoutes();
  });

  it("lists open pull requests by default", async () => {
    renderDialog();
    expect(await screen.findByText("Fix streaming")).toBeInTheDocument();
    expect(screen.getByText("#12")).toBeInTheDocument();
    expect(screen.getByText("flo")).toBeInTheDocument();
    // Checked-out PRs show their workspace name instead of the author.
    expect(screen.getByText("lyon")).toBeInTheDocument();
    expect(screen.queryByText("sam")).not.toBeInTheDocument();
  });

  it("creates a workspace from the selected pull request", async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValue({ id: "ws-new", name: "nantes" });
    const { onOpenChange } = renderDialog();

    await user.click(await screen.findByText("Fix streaming"));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith("/api/projects/p1/workspaces", {
        source: { kind: "pr", number: 12 },
      });
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("offers to open the workspace when the PR is already checked out", async () => {
    const user = userEvent.setup();
    renderDialog();

    const row = (await screen.findByText("Docs pass")).closest("button")!;
    await user.click(row);

    expect(apiPost).not.toHaveBeenCalled();
  });

  it("switches tabs and creates from a branch", async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValue({ id: "ws-new", name: "nantes" });
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Branches" }));
    // Grouped: checked-out branches that navigate, then Remote, then Local.
    expect(await screen.findByText("Remote")).toBeInTheDocument();
    expect(screen.getByText("Local")).toBeInTheDocument();
    expect(screen.getByText("Existing")).toBeInTheDocument();
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("wip/ui");
    expect(options[1]).toHaveTextContent("feat/picker");
    expect(options[2]).toHaveTextContent("fix/stream");
    await user.click(await screen.findByText("feat/picker"));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith("/api/projects/p1/workspaces", {
        source: { kind: "branch", branch: "feat/picker" },
      });
    });
  });

  it("filters rows from the search input", async () => {
    const user = userEvent.setup();
    renderDialog();

    await screen.findByText("Fix streaming");
    await user.type(screen.getByPlaceholderText("Search by title, number, or author"), "docs");

    expect(screen.queryByText("Fix streaming")).not.toBeInTheDocument();
    expect(screen.getByText("Docs pass")).toBeInTheDocument();
  });

  it("jumps to the issues tab when a GitHub issue URL is pasted", async () => {
    const user = userEvent.setup();
    renderDialog();

    await screen.findByText("Fix streaming");
    await user.click(screen.getByPlaceholderText("Search by title, number, or author"));
    await user.paste("https://github.com/acme/demo/issues/45");

    expect(await screen.findByText("Sidebar flickers")).toBeInTheDocument();
  });

  it("offers a manual row for an unknown PR number", async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValue({ id: "ws-new", name: "nantes" });
    renderDialog();

    await screen.findByText("Fix streaming");
    await user.type(screen.getByPlaceholderText("Search by title, number, or author"), "#99");
    await user.click(await screen.findByText("Pull request #99"));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith("/api/projects/p1/workspaces", {
        source: { kind: "pr", number: 99 },
      });
    });
  });

  it("shows the degraded error state when gh is unavailable", async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === "/api/projects") return Promise.resolve(projects);
      if (url === "/api/projects/p1/pulls") {
        return Promise.resolve({ pulls: [], error: "gh not authenticated" });
      }
      return Promise.resolve({ branches: [], issues: [] });
    });
    renderDialog();

    expect(await screen.findByText("gh not authenticated")).toBeInTheDocument();
  });

  it("shows a real error on the branches tab instead of 'No results found.'", async () => {
    const user = userEvent.setup();
    apiGet.mockImplementation((url: string) => {
      if (url === "/api/projects") return Promise.resolve(projects);
      if (url === "/api/projects/p1/branches") {
        return Promise.reject(new Error("Failed to list branches"));
      }
      return Promise.resolve({ pulls: [], issues: [] });
    });
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Branches" }));

    expect(await screen.findByText("Failed to list branches")).toBeInTheDocument();
    expect(screen.queryByText("No results found.")).not.toBeInTheDocument();
  });
});
