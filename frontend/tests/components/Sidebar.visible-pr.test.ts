import { describe, expect, it } from "vitest";
import { collectVisiblePrWorkspaceIds } from "@/components/Sidebar";
import type { Project } from "@/types";
import type { SidebarProjectFolderView } from "@/hooks/useSidebarProjectFolders";

function project(id: string, workspaceIds: string[]): Project {
  return {
    id,
    name: id,
    createdAt: "2026-01-01T00:00:00.000Z",
    workspaces: workspaceIds.map((wsId) => ({
      id: wsId,
      name: wsId,
      branch: `workspace/${wsId}`,
      status: "idle",
      createdAt: "2026-01-01T00:00:00.000Z",
    })),
  };
}

function folder(id: string, projects: Project[]): SidebarProjectFolderView {
  return {
    id,
    name: id,
    projectIds: projects.map((entry) => entry.id),
    projects,
  };
}

describe("collectVisiblePrWorkspaceIds", () => {
  it("includes only workspaces from expanded folders and expanded projects", () => {
    const p1 = project("p1", ["ws-1"]);
    const p2 = project("p2", ["ws-2"]);
    const p3 = project("p3", ["ws-3"]);

    expect(collectVisiblePrWorkspaceIds({
      folders: [folder("folder-open", [p1, p2]), folder("folder-closed", [p3])],
      rootProjects: [],
      expandedProjects: { p1: true, p2: false, p3: true },
      activeProjectId: undefined,
      activeWsId: undefined,
      isFolderExpanded: (folderId) => folderId === "folder-open",
    })).toEqual(["ws-1"]);
  });

  it("always includes the active workspace even when its project is hidden", () => {
    const p1 = project("p1", ["ws-1"]);
    const p2 = project("p2", ["ws-2"]);

    expect(collectVisiblePrWorkspaceIds({
      folders: [folder("folder-closed", [p1])],
      rootProjects: [p2],
      expandedProjects: { p2: false },
      activeProjectId: undefined,
      activeWsId: "ws-1",
      isFolderExpanded: () => false,
    })).toEqual(["ws-1"]);
  });

  it("uses the active project as the default expanded project", () => {
    const p1 = project("p1", ["ws-1"]);
    const p2 = project("p2", ["ws-2"]);

    expect(collectVisiblePrWorkspaceIds({
      folders: [],
      rootProjects: [p1, p2],
      expandedProjects: {},
      activeProjectId: "p2",
      activeWsId: undefined,
      isFolderExpanded: () => true,
    })).toEqual(["ws-2"]);
  });
});
