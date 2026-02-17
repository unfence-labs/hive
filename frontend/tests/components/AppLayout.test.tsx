import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTerminalContext } from "@/contexts/TerminalContext";
import AppLayout from "@/components/AppLayout";

const mocks = vi.hoisted(() => ({
  terminalRender: vi.fn(),
}));

vi.mock("@/components/Sidebar", () => ({
  default: () => <div data-testid="sidebar">Sidebar</div>,
}));

vi.mock("@/components/Terminal", () => ({
  default: ({
    workspaceId,
    visible = true,
    onExit,
  }: {
    workspaceId: string;
    visible?: boolean;
    onExit?: () => void;
  }) => {
    mocks.terminalRender({ workspaceId, visible });
    return (
      <button
        type="button"
        data-testid={`terminal-${workspaceId}`}
        data-visible={visible ? "true" : "false"}
        onClick={onExit}
      >
        terminal {workspaceId}
      </button>
    );
  },
}));

function TerminalControls() {
  const { activeTerminals, visibleTerminalWsId, openTerminal, setVisibleTerminal } = useTerminalContext();
  return (
    <div>
      <button type="button" onClick={() => openTerminal("ws-1")}>open ws-1</button>
      <button type="button" onClick={() => openTerminal("ws-2")}>open ws-2</button>
      <button type="button" onClick={() => setVisibleTerminal("ws-1")}>show ws-1</button>
      <div data-testid="active-terminals">{[...activeTerminals].sort().join(",")}</div>
      <div data-testid="visible-terminal">{visibleTerminalWsId ?? "none"}</div>
    </div>
  );
}

function renderLayout(initialEntry = "/workspaces/ws-1") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          element={
            <AppLayout
              projects={[]}
              loading={false}
              onAddProject={vi.fn()}
              onAddWorkspace={vi.fn().mockResolvedValue(undefined)}
            />
          }
        >
          <Route path="/workspaces/:wsId" element={<TerminalControls />} />
          <Route path="/settings/appearance" element={<div data-testid="settings-content">settings</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("AppLayout", () => {
  beforeEach(() => {
    mocks.terminalRender.mockClear();
  });

  it("renders one terminal layer per active workspace and tracks visibility", async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.click(screen.getByRole("button", { name: "open ws-1" }));
    await user.click(screen.getByRole("button", { name: "open ws-2" }));

    expect(screen.getByTestId("active-terminals")).toHaveTextContent("ws-1,ws-2");
    expect(screen.getByTestId("visible-terminal")).toHaveTextContent("ws-2");
    expect(screen.getByTestId("terminal-ws-1")).toHaveAttribute("data-visible", "false");
    expect(screen.getByTestId("terminal-ws-2")).toHaveAttribute("data-visible", "true");

    await user.click(screen.getByRole("button", { name: "show ws-1" }));
    expect(screen.getByTestId("terminal-ws-1")).toHaveAttribute("data-visible", "true");
    expect(screen.getByTestId("terminal-ws-2")).toHaveAttribute("data-visible", "false");
  });

  it("uses the wider desktop right offset for terminal layer to avoid panel overlap", async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.click(screen.getByRole("button", { name: "open ws-1" }));

    const terminalLayer = screen.getByTestId("terminal-ws-1").closest("div");
    expect(terminalLayer).toBeInTheDocument();
    expect(terminalLayer?.className).toContain("lg:right-[420px]");
  });

  it("removes a terminal when it exits via onExit callback", async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.click(screen.getByRole("button", { name: "open ws-1" }));
    expect(screen.getByTestId("terminal-ws-1")).toBeInTheDocument();

    await user.click(screen.getByTestId("terminal-ws-1"));

    expect(screen.queryByTestId("terminal-ws-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("active-terminals")).toBeEmptyDOMElement();
    expect(screen.getByTestId("visible-terminal")).toHaveTextContent("none");
  });

  it("does not render the legacy titlebar spacer in workspace layout", () => {
    const { container } = renderLayout();

    const main = container.querySelector("main");
    const legacySpacerInMain = main?.querySelector("[style*='--titlebar-inset']");

    expect(legacySpacerInMain).not.toBeInTheDocument();
    expect(main).toHaveClass("relative");
  });

  it("does not render the legacy titlebar spacer in settings layout", async () => {
    const { container } = renderLayout("/settings/appearance");
    await screen.findByTestId("settings-content");

    const main = container.querySelector("main");
    const legacySpacerInMain = main?.querySelector("[style*='--titlebar-inset']");

    expect(legacySpacerInMain).not.toBeInTheDocument();
    expect(main).toHaveClass("relative");
  });
});
