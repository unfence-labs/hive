import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Sidebar from "@/components/Sidebar";
import type { Project } from "@/types";

function renderSidebar(path: string, projects: Project[], onDeleteProject = vi.fn()) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/projects/:id"
          element={
            <Sidebar
              projects={projects}
              loading={false}
              onAddProject={vi.fn()}
              onDeleteProject={onDeleteProject}
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
              onDeleteProject={onDeleteProject}
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

  it("renders projects and workspace links", () => {
    renderSidebar("/projects/p1", projects);

    expect(screen.getByRole("link", { name: "Alpha" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Beta" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "tokyo" })).toBeInTheDocument();
  });

  it("calls delete callback after confirmation", async () => {
    const user = userEvent.setup();
    const onDeleteProject = vi.fn().mockResolvedValue(undefined);
    renderSidebar("/projects/p1", projects, onDeleteProject);

    await user.click(screen.getAllByTitle("Delete project")[0]!);
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(onDeleteProject).toHaveBeenCalledWith("p1");
    });
  });
});
