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
      return {
        unsubscribe: () => { getSet(workspaceId).delete(handler); },
        hadBufferedMessages: false,
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

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.queryByText("workspace/tokyo")).not.toBeInTheDocument();

    await user.click(screen.getByText("Alpha"));
    expect(screen.getByText("workspace/tokyo")).toBeInTheDocument();
  });

  it("expands the active project's workspaces on workspace route", () => {
    renderSidebar("/workspaces/w1", projects);

    expect(screen.getByText("workspace/tokyo")).toBeInTheDocument();
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

  it("shows working indicator on streaming workspace row only", async () => {
    const { __wsMock } = await getWsMock();
    renderSidebar("/workspaces/w1", projects);

    expect(screen.queryByText("working...")).not.toBeInTheDocument();
    expect(screen.getByText("tokyo")).toBeInTheDocument();

    act(() => {
      __wsMock.emit("w1", { type: "status", status: "busy", streaming: true });
    });

    expect(screen.getByText("working...")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();

    act(() => {
      __wsMock.emit("w1", { type: "status", status: "busy", streaming: false });
    });

    expect(screen.queryByText("working...")).not.toBeInTheDocument();
    expect(screen.getByText("tokyo")).toBeInTheDocument();
  });
});
