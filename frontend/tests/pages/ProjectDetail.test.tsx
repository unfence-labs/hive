import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ProjectDetail from "@/pages/settings/ProjectDetail";
import { api } from "@/hooks/useApi";
import type { Project } from "@/types";

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

function renderProjectDetail(
  path: string,
  projects: Project[],
  env = { exists: false, content: "" },
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url.includes("/env")) {
      return Promise.resolve(env);
    }
    return Promise.resolve(projects);
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/settings/repositories/:projectId"
            element={<ProjectDetail />}
          />
          <Route path="/settings/appearance" element={<div>Appearance settings</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ProjectDetail", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.put).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.delete).mockReset();
  });

  it("always renders repository path rows with placeholders when missing", async () => {
    const projects: Project[] = [
      {
        id: "p1",
        name: "Alpha",
        url: "https://github.com/acme/alpha.git",
        createdAt: "2026-02-11T00:00:00.000Z",
        workspaces: [],
      },
    ];

    renderProjectDetail("/settings/repositories/p1", projects);

    const heading = await screen.findByRole("heading", { name: "Alpha" });
    expect(heading.closest("[data-tauri-drag-region]")).toBeInTheDocument();
    expect(screen.getByText("Bare repo")).toBeInTheDocument();
    expect(screen.getByText("Workspaces")).toBeInTheDocument();
    expect(screen.getAllByText("\u2014")).toHaveLength(2);
  });

  it("shows configured repository paths when provided", async () => {
    const projects: Project[] = [
      {
        id: "p1",
        name: "Alpha",
        url: "https://github.com/acme/alpha.git",
        repoPath: "/repos/alpha.git",
        workspacesPath: "/workspaces/alpha",
        createdAt: "2026-02-11T00:00:00.000Z",
        workspaces: [],
      },
    ];

    renderProjectDetail("/settings/repositories/p1", projects);

    expect(await screen.findByText("/repos/alpha.git")).toBeInTheDocument();
    expect(screen.getByText("/workspaces/alpha")).toBeInTheDocument();
  });

  it("shows project environment as not configured by default", async () => {
    const projects: Project[] = [
      {
        id: "p1",
        name: "Alpha",
        url: "https://github.com/acme/alpha.git",
        createdAt: "2026-02-11T00:00:00.000Z",
        workspaces: [],
      },
    ];

    renderProjectDetail("/settings/repositories/p1", projects);

    expect(await screen.findByText("Environment")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Loading" })).toBeDisabled();
    expect(await screen.findByText("Not configured")).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/API_KEY/)).not.toBeInTheDocument();
  });

  it("saves project environment changes", async () => {
    const user = userEvent.setup();
    vi.mocked(api.put).mockResolvedValueOnce({
      exists: true,
      content: "API_KEY=secret\n",
    });
    const projects: Project[] = [
      {
        id: "p1",
        name: "Alpha",
        url: "https://github.com/acme/alpha.git",
        createdAt: "2026-02-11T00:00:00.000Z",
        workspaces: [],
      },
    ];

    renderProjectDetail("/settings/repositories/p1", projects);

    expect(await screen.findByRole("button", { name: "Configure" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Configure" }));
    const editor = await screen.findByRole("textbox", { name: "Environment variables" });
    expect(editor.closest(".cm-editor")).toBeInTheDocument();
    await user.click(editor);
    await user.paste("API_KEY=secret\n");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith("/api/projects/p1/env", {
        content: "API_KEY=secret\n",
      });
    });
  });

  it("deletes configured project environment", async () => {
    const user = userEvent.setup();
    vi.mocked(api.delete).mockResolvedValueOnce(undefined);
    const projects: Project[] = [
      {
        id: "p1",
        name: "Alpha",
        url: "https://github.com/acme/alpha.git",
        createdAt: "2026-02-11T00:00:00.000Z",
        workspaces: [],
      },
    ];

    renderProjectDetail("/settings/repositories/p1", projects, {
      exists: true,
      content: "API_KEY=secret\n",
    });

    expect(await screen.findByText("1 entry stored locally for new workspaces.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const editor = await screen.findByRole("textbox", { name: "Environment variables" });
    await waitFor(() => {
      expect(editor).toHaveTextContent("API_KEY=secret");
    });
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith("/api/projects/p1/env");
    });
    expect(screen.getByText("Not configured")).toBeInTheDocument();
  });

  it("does not count project environment comments or blank lines as entries", async () => {
    const projects: Project[] = [
      {
        id: "p1",
        name: "Alpha",
        url: "https://github.com/acme/alpha.git",
        createdAt: "2026-02-11T00:00:00.000Z",
        workspaces: [],
      },
    ];

    renderProjectDetail("/settings/repositories/p1", projects, {
      exists: true,
      content: "# API credentials\n\nAPI_KEY=secret\n   # ignored\nDATABASE_URL=postgres://local\n",
      path: "/hive-data/proj-1/env/.env",
    });

    expect(await screen.findByText("Env file")).toBeInTheDocument();
    expect(screen.getByText("/hive-data/proj-1/env/.env")).toBeInTheDocument();
    expect(await screen.findByText("2 entries stored locally for new workspaces.")).toBeInTheDocument();
  });

  it("renders project environment content in the shared CodeMirror editor", async () => {
    const user = userEvent.setup();
    const projects: Project[] = [
      {
        id: "p1",
        name: "Alpha",
        url: "https://github.com/acme/alpha.git",
        createdAt: "2026-02-11T00:00:00.000Z",
        workspaces: [],
      },
    ];

    renderProjectDetail("/settings/repositories/p1", projects, {
      exists: true,
      content: "# API credentials\nAPI_KEY=secret\n",
    });

    await user.click(await screen.findByRole("button", { name: "Edit" }));
    const editor = await screen.findByRole("textbox", { name: "Environment variables" });
    const codeMirror = editor.closest(".cm-editor");

    expect(codeMirror).toBeInTheDocument();
    expect(within(codeMirror as HTMLElement).queryByRole("textbox")).toBe(editor);
    expect(editor).toHaveTextContent("# API credentials");
    expect(editor).toHaveTextContent("API_KEY=secret");
  });

  it("deletes project after confirmation and returns to appearance settings", async () => {
    const user = userEvent.setup();
    vi.mocked(api.delete).mockResolvedValue(undefined);

    const projects: Project[] = [
      {
        id: "p1",
        name: "Alpha",
        url: "https://github.com/acme/alpha.git",
        createdAt: "2026-02-11T00:00:00.000Z",
        workspaces: [],
      },
    ];

    renderProjectDetail("/settings/repositories/p1", projects);

    await screen.findByRole("heading", { name: "Alpha" });
    await user.click(screen.getByRole("button", { name: "Delete project" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Delete project" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith("/api/projects/p1");
      expect(screen.getByText("Appearance settings")).toBeInTheDocument();
    });
  });
});
