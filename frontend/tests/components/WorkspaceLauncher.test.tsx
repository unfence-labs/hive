import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import WorkspaceLauncher from "@/components/WorkspaceLauncher";
import type { Project } from "@/types";
import { subscribeAppCommand, type AppCommand } from "@/lib/app-commands";

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

function LauncherHarness() {
  const [picker, setPicker] = useState<{ open: boolean; projectId?: string }>({ open: false });
  return (
    <>
      <WorkspaceLauncher
        pickerOpen={picker.open}
        pickerProjectId={picker.projectId}
        onPickerOpenChange={(open) =>
          setPicker((prev) => (open ? { ...prev, open: true } : { open: false }))
        }
      />
      <LocationProbe />
    </>
  );
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
}

function renderLauncher(
  projects: Project[],
  initialEntries: string[] = ["/"],
  initialIndex?: number,
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(["projects"], projects);
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}>
        <LauncherHarness />
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
    expect(screen.getByText("Conversation actions")).toBeInTheDocument();
    expect(screen.getByText("Quick open file")).toBeInTheDocument();
    expect(screen.getByText("Previous tab")).toBeInTheDocument();
    expect(screen.getByText("Find next match")).toBeInTheDocument();
    expect(screen.getByText("Navigation")).toBeInTheDocument();
    expect(screen.getByText("Application")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("runs global navigation actions from the spotlight", async () => {
    renderLauncher(singleProject);
    pressShortcut("k");

    fireEvent.click(await screen.findByText("Settings"));

    expect(screen.getByTestId("location")).toHaveTextContent("/settings/appearance");
  });

  it("dispatches workspace shortcuts to the active conversation", () => {
    const commands: AppCommand[] = [];
    const unsubscribers = ([
      "quick-open-file",
      "new-chat",
      "previous-tab",
      "next-tab",
      "find-next",
      "find-previous",
    ] as AppCommand[]).map((command) =>
      subscribeAppCommand(command, () => commands.push(command)),
    );
    renderLauncher(singleProject, ["/workspaces/w1"]);

    pressShortcut("p");
    pressShortcut("t");
    fireEvent.keyDown(window, { key: "{", code: "BracketLeft", metaKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: "Tab", ctrlKey: true });
    pressShortcut("g");
    pressShortcut("G", true);

    expect(commands).toEqual([
      "quick-open-file",
      "new-chat",
      "previous-tab",
      "next-tab",
      "find-next",
      "find-previous",
    ]);
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  });

  it("ignores workspace shortcuts when no workspace or brain is active", async () => {
    const commands: AppCommand[] = [];
    const unsubscribe = subscribeAppCommand("quick-open-file", () => commands.push("quick-open-file"));
    renderLauncher(singleProject);

    pressShortcut("p");
    expect(commands).toEqual([]);

    pressShortcut("k");
    const item = (await screen.findByText("Quick open file")).closest("[cmdk-item]");
    expect(item).toHaveAttribute("aria-disabled", "true");
    unsubscribe();
  });

  it("supports history and zoom shortcuts", () => {
    renderLauncher(singleProject, ["/home", "/brain"], 1);

    fireEvent.keyDown(window, { key: "[", code: "BracketLeft", metaKey: true });
    expect(screen.getByTestId("location")).toHaveTextContent("/home");

    fireEvent.keyDown(window, { key: "]", code: "BracketRight", metaKey: true });
    expect(screen.getByTestId("location")).toHaveTextContent("/brain");

    fireEvent.keyDown(window, { key: "+", code: "Equal", metaKey: true, shiftKey: true });
    expect(document.documentElement.style.zoom).toBe("1.1");
    pressShortcut("-");
    expect(document.documentElement.style.zoom).toBe("1");
    pressShortcut("0");
    expect(document.documentElement.style.zoom).toBe("1");
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
