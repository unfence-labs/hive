import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import ProjectDetail from "@/pages/settings/ProjectDetail";
import type { Project } from "@/types";

function renderProjectDetail(path: string, projects: Project[], onDeleteProject = vi.fn().mockResolvedValue(undefined)) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/settings/repositories/:projectId"
          element={<ProjectDetail projects={projects} onDeleteProject={onDeleteProject} />}
        />
        <Route path="/settings/appearance" element={<div>Appearance settings</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProjectDetail", () => {
  it("always renders repository path rows with placeholders when missing", () => {
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

    expect(screen.getByText("Bare repo path")).toBeInTheDocument();
    expect(screen.getByText("Workspaces path")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("shows configured repository paths when provided", () => {
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

    expect(screen.getByText("/repos/alpha.git")).toBeInTheDocument();
    expect(screen.getByText("/workspaces/alpha")).toBeInTheDocument();
  });

  it("deletes project after confirmation and returns to appearance settings", async () => {
    const user = userEvent.setup();
    const onDeleteProject = vi.fn().mockResolvedValue(undefined);
    const projects: Project[] = [
      {
        id: "p1",
        name: "Alpha",
        url: "https://github.com/acme/alpha.git",
        createdAt: "2026-02-11T00:00:00.000Z",
        workspaces: [],
      },
    ];

    renderProjectDetail("/settings/repositories/p1", projects, onDeleteProject);

    await user.click(screen.getByRole("button", { name: "Delete project" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Delete project" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(onDeleteProject).toHaveBeenCalledWith("p1");
      expect(screen.getByText("Appearance settings")).toBeInTheDocument();
    });
  });
});
