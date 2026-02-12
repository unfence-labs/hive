import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Sidebar from "@/components/Sidebar";
import type { Project } from "@/types";

function renderSidebar(path: string, projects: Project[], onAddWorkspace = vi.fn()) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/projects"
          element={
            <Sidebar
              projects={projects}
              loading={false}
              onAddProject={vi.fn()}
              onAddWorkspace={onAddWorkspace}
            />
          }
        />
        <Route
          path="/workspaces/:wsId"
          element={
            <Sidebar
              projects={projects}
              loading={false}
              onAddProject={vi.fn()}
              onAddWorkspace={onAddWorkspace}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Sidebar", () => {
  const projects: Project[] = [
    {
      id: "p1",
      name: "Alpha",
      url: "https://github.com/acme/alpha.git",
      createdAt: "2026-02-11T00:00:00.000Z",
      workspaces: [
        {
          id: "w1",
          name: "tokyo",
          branch: "workspace/tokyo",
          status: "busy",
          createdAt: "2026-02-11T00:00:00.000Z",
        },
      ],
    },
    {
      id: "p2",
      name: "Beta",
      url: "https://github.com/acme/beta.git",
      createdAt: "2026-02-11T00:00:00.000Z",
      workspaces: [],
    },
  ];

  it("renders projects and toggles workspace links from collapsible", async () => {
    const user = userEvent.setup();
    renderSidebar("/projects", projects);

    expect(screen.getByRole("button", { name: "Alpha" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Beta" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "tokyo" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Alpha" }));
    expect(screen.getByRole("link", { name: "tokyo" })).toBeInTheDocument();
  });

  it("expands the active project's workspaces on workspace route", () => {
    renderSidebar("/workspaces/w1", projects);

    expect(screen.getByRole("link", { name: "tokyo" })).toBeInTheDocument();
  });

  it("calls add workspace callback", async () => {
    const user = userEvent.setup();
    const onAddWorkspace = vi.fn().mockResolvedValue(undefined);
    renderSidebar("/projects", projects, onAddWorkspace);

    await user.click(screen.getByRole("button", { name: "Add workspace to Alpha" }));

    await waitFor(() => {
      expect(onAddWorkspace).toHaveBeenCalledWith("p1");
    });
  });
});
