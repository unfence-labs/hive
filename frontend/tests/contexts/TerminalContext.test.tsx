import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TerminalProvider, useTerminalContext } from "@/contexts/TerminalContext";

function ContextProbe() {
  const { activeTerminals, visibleTerminalWsId, openTerminal, closeTerminal, setVisibleTerminal } = useTerminalContext();

  return (
    <div>
      <div data-testid="active">{[...activeTerminals].sort().join(",")}</div>
      <div data-testid="visible">{visibleTerminalWsId ?? "none"}</div>
      <button type="button" onClick={() => openTerminal("ws-1")}>open ws-1</button>
      <button type="button" onClick={() => openTerminal("ws-2")}>open ws-2</button>
      <button type="button" onClick={() => closeTerminal("ws-1")}>close ws-1</button>
      <button type="button" onClick={() => closeTerminal("ws-2")}>close ws-2</button>
      <button type="button" onClick={() => setVisibleTerminal("ws-1")}>show ws-1</button>
      <button type="button" onClick={() => setVisibleTerminal(null)}>hide terminal</button>
    </div>
  );
}

describe("TerminalContext", () => {
  it("throws when hook is used outside provider", () => {
    expect(() => render(<ContextProbe />)).toThrow("useTerminalContext must be used within TerminalProvider");
  });

  it("opens a terminal and marks it visible", async () => {
    const user = userEvent.setup();
    render(
      <TerminalProvider>
        <ContextProbe />
      </TerminalProvider>,
    );

    await user.click(screen.getByRole("button", { name: "open ws-1" }));

    expect(screen.getByTestId("active")).toHaveTextContent("ws-1");
    expect(screen.getByTestId("visible")).toHaveTextContent("ws-1");
  });

  it("keeps one active entry when opening the same workspace repeatedly", async () => {
    const user = userEvent.setup();
    render(
      <TerminalProvider>
        <ContextProbe />
      </TerminalProvider>,
    );

    await user.click(screen.getByRole("button", { name: "open ws-1" }));
    await user.click(screen.getByRole("button", { name: "open ws-1" }));

    expect(screen.getByTestId("active")).toHaveTextContent("ws-1");
  });

  it("updates visible terminal when opening another workspace", async () => {
    const user = userEvent.setup();
    render(
      <TerminalProvider>
        <ContextProbe />
      </TerminalProvider>,
    );

    await user.click(screen.getByRole("button", { name: "open ws-1" }));
    await user.click(screen.getByRole("button", { name: "open ws-2" }));

    expect(screen.getByTestId("active")).toHaveTextContent("ws-1,ws-2");
    expect(screen.getByTestId("visible")).toHaveTextContent("ws-2");
  });

  it("hides terminal when closing the currently visible workspace", async () => {
    const user = userEvent.setup();
    render(
      <TerminalProvider>
        <ContextProbe />
      </TerminalProvider>,
    );

    await user.click(screen.getByRole("button", { name: "open ws-1" }));
    await user.click(screen.getByRole("button", { name: "close ws-1" }));

    expect(screen.getByTestId("active")).toBeEmptyDOMElement();
    expect(screen.getByTestId("visible")).toHaveTextContent("none");
  });

  it("does not hide visible terminal when closing a different workspace", async () => {
    const user = userEvent.setup();
    render(
      <TerminalProvider>
        <ContextProbe />
      </TerminalProvider>,
    );

    await user.click(screen.getByRole("button", { name: "open ws-1" }));
    await user.click(screen.getByRole("button", { name: "open ws-2" }));
    await user.click(screen.getByRole("button", { name: "close ws-1" }));

    expect(screen.getByTestId("active")).toHaveTextContent("ws-2");
    expect(screen.getByTestId("visible")).toHaveTextContent("ws-2");
  });

  it("can hide overlay without closing active terminals", async () => {
    const user = userEvent.setup();
    render(
      <TerminalProvider>
        <ContextProbe />
      </TerminalProvider>,
    );

    await user.click(screen.getByRole("button", { name: "open ws-1" }));
    await user.click(screen.getByRole("button", { name: "hide terminal" }));

    expect(screen.getByTestId("active")).toHaveTextContent("ws-1");
    expect(screen.getByTestId("visible")).toHaveTextContent("none");
  });
});
