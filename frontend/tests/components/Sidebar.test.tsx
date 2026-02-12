import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Sidebar from "@/components/Sidebar";
import type { Project, WsOutgoing } from "@/types";

vi.mock("@/lib/ws-transport", () => {
  const messageHandlers = new Map<string, Set<(msg: WsOutgoing) => void>>();

  const getSet = (workspaceId: string) => {
    const existing = messageHandlers.get(workspaceId);
    if (existing) return existing;
    const created = new Set<(msg: WsOutgoing) => void>();
    messageHandlers.set(workspaceId, created);
    return created;
  };

  const wsTransport = {
    onMessage: vi.fn((workspaceId: string, handler: (msg: WsOutgoing) => void) => {
      getSet(workspaceId).add(handler);
      return () => {
        getSet(workspaceId).delete(handler);
      };
    }),
  };

  const __wsMock = {
    emit: (workspaceId: string, msg: WsOutgoing) => {
      for (const handler of messageHandlers.get(workspaceId) ?? []) handler(msg);
    },
    reset: () => {
      messageHandlers.clear();
      wsTransport.onMessage.mockClear();
    },
  };

  return { wsTransport, __wsMock };
});

const getWsMock = async () =>
  (await import("@/lib/ws-transport")) as unknown as {
    __wsMock: {
      emit: (workspaceId: string, msg: WsOutgoing) => void;
      reset: () => void;
    };
  };

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

  beforeEach(async () => {
    const { __wsMock } = await getWsMock();
    __wsMock.reset();
  });

  it("renders projects and toggles workspace links from collapsible", async () => {
    const user = userEvent.setup();
    renderSidebar("/projects", projects);

    expect(screen.getByRole("button", { name: /^Alpha/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Beta/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "tokyo" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Alpha/ }));
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

  it("shows Working on the streaming workspace row only", async () => {
    const { __wsMock } = await getWsMock();
    renderSidebar("/workspaces/w1", projects);

    expect(screen.queryByText("Working")).not.toBeInTheDocument();

    act(() => {
      __wsMock.emit("w1", { type: "status", status: "busy", streaming: true });
    });

    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Alpha/ })).toBeInTheDocument();

    act(() => {
      __wsMock.emit("w1", { type: "status", status: "busy", streaming: false });
    });

    expect(screen.queryByText("Working")).not.toBeInTheDocument();
  });

  it("updates workspace dot color from live status", async () => {
    const { __wsMock } = await getWsMock();
    renderSidebar("/workspaces/w1", projects);

    const link = screen.getByRole("link", { name: "tokyo" });
    const dot = link.querySelector("span");
    expect(dot?.className).toContain("bg-blue-500");

    act(() => {
      __wsMock.emit("w1", { type: "status", status: "idle", streaming: false });
    });

    await waitFor(() => {
      expect(dot?.className).toContain("bg-muted-foreground/40");
    });
  });
});
