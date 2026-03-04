import { act, render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import ScriptPanel from "@/components/ScriptPanel";

const state = vi.hoisted(() => ({
  terminals: [] as Array<{
    loadAddon: ReturnType<typeof vi.fn>;
    open: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }>,
  fitAddons: [] as Array<{
    fit: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class TerminalMock {
    loadAddon = vi.fn();
    open = vi.fn();
    dispose = vi.fn();
    constructor() {
      state.terminals.push(this);
    }
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class FitAddonMock {
    fit = vi.fn();
    constructor() {
      state.fitAddons.push(this);
    }
  },
}));

function renderPanel(
  overrides?: Partial<ComponentProps<typeof ScriptPanel>>,
) {
  const onStart = overrides?.onStart ?? vi.fn();
  const onStop = overrides?.onStop ?? vi.fn();
  const onStartTerminal = overrides?.onStartTerminal ?? vi.fn();
  const onStopTerminal = overrides?.onStopTerminal ?? vi.fn();
  const onConnectOutput = overrides?.onConnectOutput ?? vi.fn();
  const onDisconnectOutput = overrides?.onDisconnectOutput ?? vi.fn();

  const defaultProps: ComponentProps<typeof ScriptPanel> = {
    config: {
      scripts: {
        setup: "npm ci",
        run: {
          run: "npm run dev",
        },
      },
    },
    status: {
      setup: { state: "idle" },
      run: { state: "idle" },
    },
    onStart,
    onStop,
    onStartTerminal,
    onStopTerminal,
    onConnectOutput,
    onDisconnectOutput,
  };

  const utils = render(<ScriptPanel {...defaultProps} {...overrides} />);
  return { ...utils, onStart, onStop, onStartTerminal, onStopTerminal, onConnectOutput, onDisconnectOutput };
}

describe("ScriptPanel", () => {
  beforeEach(() => {
    state.terminals.length = 0;
    state.fitAddons.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders placeholder when no scripts are defined", () => {
    renderPanel({ config: {} });

    expect(screen.getByText("hive.json")).toBeInTheDocument();
    expect(screen.queryByText("Start terminal")).not.toBeInTheDocument();
  });

  it("renders placeholder when config is null", () => {
    renderPanel({ config: null });

    expect(screen.getByText("hive.json")).toBeInTheDocument();
    expect(screen.queryByText("Start terminal")).not.toBeInTheDocument();
  });

  it("starts setup script from idle state", async () => {
    const { onStart } = renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByTitle("Run setup"));
      await Promise.resolve();
    });

    expect(onStart).toHaveBeenCalledWith("setup");
  });

  it("starts terminal from idle state when terminal tab is selected", async () => {
    const { onStart, onStartTerminal } = renderPanel();

    // Switch to terminal tab first
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Terminal"));
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByTitle("Start terminal"));
      await Promise.resolve();
    });

    expect(onStartTerminal).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
  });

  it("shows wave indicator when script is running", () => {
    const { container } = renderPanel({
      status: {
        setup: { state: "running" },
        run: { state: "idle" },
      },
    });

    // Wave indicator renders as an SVG with viewBox="0 0 12 12" and 3 rect bars
    const waveSvg = container.querySelector('svg[viewBox="0 0 12 12"]');
    expect(waveSvg).toBeInTheDocument();
    expect(waveSvg?.querySelectorAll("rect")).toHaveLength(3);
  });

  it("does not show wave indicator when script is done or errored", () => {
    const { container, rerender } = render(
      <ScriptPanel
        config={{ scripts: { setup: "npm ci" } }}
        status={{ setup: { state: "done", exitCode: 0 }, run: { state: "idle" } }}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onStartTerminal={vi.fn()}
        onStopTerminal={vi.fn()}
        onConnectOutput={vi.fn()}
        onDisconnectOutput={vi.fn()}
      />,
    );

    // No wave indicator on done
    expect(container.querySelector('svg[viewBox="0 0 12 12"]')).not.toBeInTheDocument();

    rerender(
      <ScriptPanel
        config={{ scripts: { setup: "npm ci" } }}
        status={{ setup: { state: "error", exitCode: 1 }, run: { state: "idle" } }}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onStartTerminal={vi.fn()}
        onStopTerminal={vi.fn()}
        onConnectOutput={vi.fn()}
        onDisconnectOutput={vi.fn()}
      />,
    );

    // No wave indicator on error
    expect(container.querySelector('svg[viewBox="0 0 12 12"]')).not.toBeInTheDocument();
  });

  it("shows check icon for setup done but not for run done", () => {
    const { container } = render(
      <ScriptPanel
        config={{ scripts: { setup: "npm ci", run: { run: "npm run dev" } } }}
        status={{ setup: { state: "done", exitCode: 0 }, run: { state: "done", exitCode: 0 } }}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onStartTerminal={vi.fn()}
        onStopTerminal={vi.fn()}
        onConnectOutput={vi.fn()}
        onDisconnectOutput={vi.fn()}
      />,
    );

    // Setup tab shows a check icon (lucide SVG with 24x24 viewBox), run tab does not
    const setupBtn = screen.getByRole("button", { name: /setup/i });
    const runBtn = screen.getByRole("button", { name: /^run$/i });
    expect(setupBtn.querySelector("svg")).toBeInTheDocument();
    expect(runBtn.querySelector("svg")).not.toBeInTheDocument();
  });

  it("shows running terminal, connects output, and can stop script", async () => {
    const { onStop, onConnectOutput } = renderPanel({
      status: {
        setup: { state: "running" },
        run: { state: "idle" },
      },
    });

    act(() => {
      vi.advanceTimersByTime(60);
    });

    expect(onConnectOutput).toHaveBeenCalledTimes(1);
    expect(onConnectOutput).toHaveBeenCalledWith("setup", expect.anything());

    act(() => {
      fireEvent.click(screen.getByTitle("Stop"));
    });
    expect(onStop).toHaveBeenCalledWith("setup");
  });

  it("shows running terminal for terminal tab and stops via terminal callbacks", () => {
    const { onStop, onStopTerminal, onConnectOutput } = renderPanel({
      config: { scripts: { setup: "npm ci" }, port: 3000 },
      status: {
        setup: { state: "idle" },
        terminal: { state: "running" },
      },
    });

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Terminal" }));
    });

    act(() => {
      vi.advanceTimersByTime(60);
    });

    expect(onConnectOutput).toHaveBeenCalledWith("terminal", expect.anything());
    expect(screen.queryByText("Port 3000")).not.toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByTitle("Stop"));
    });

    expect(onStopTerminal).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
  });

  it("re-runs finished script and disconnects old terminal first", async () => {
    const { onStart, onDisconnectOutput } = renderPanel({
      status: {
        setup: { state: "done", exitCode: 0 },
        run: { state: "idle" },
      },
    });

    act(() => {
      vi.advanceTimersByTime(60);
    });

    await act(async () => {
      fireEvent.click(screen.getByTitle("Re-run"));
      await Promise.resolve();
    });

    expect(onDisconnectOutput).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith("setup");
  });

  it("uses run tab when setup script does not exist and shows run port badge", () => {
    const { onConnectOutput } = renderPanel({
      config: {
        scripts: {
          run: { run: "npm run dev" },
        },
        port: 3000,
      },
      status: {
        setup: { state: "idle" },
        run: { state: "running" },
      },
    });

    act(() => {
      vi.advanceTimersByTime(60);
    });

    expect(onConnectOutput).toHaveBeenCalledWith("run", expect.anything());
    expect(screen.getByText("Port 3000")).toBeInTheDocument();
  });

  it("switches tabs by reconnecting terminal output", async () => {
    const { onConnectOutput, onDisconnectOutput } = renderPanel({
      config: {
        scripts: {
          setup: "npm ci",
          run: { run: "npm run dev" },
        },
      },
      status: {
        setup: { state: "running" },
        run: { state: "running" },
      },
    });

    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(onConnectOutput).toHaveBeenNthCalledWith(1, "setup", expect.anything());

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Run" }));
    });
    act(() => {
      vi.advanceTimersByTime(60);
    });

    expect(onDisconnectOutput).toHaveBeenCalled();
    expect(onConnectOutput).toHaveBeenNthCalledWith(2, "run", expect.anything());
  });

  it("renders tabs for each named run script", () => {
    renderPanel({
      config: {
        scripts: {
          setup: "npm ci",
          run: {
            backend: "npm run dev:backend",
            frontend: "npm run dev:frontend",
          },
        },
      },
      status: {
        setup: { state: "idle" },
        backend: { state: "idle" },
        frontend: { state: "idle" },
      },
    });

    expect(screen.getByRole("button", { name: "Setup" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Backend" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Frontend" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Terminal" })).toBeInTheDocument();
  });

  it("starts a named run script when selected", async () => {
    const { onStart } = renderPanel({
      config: {
        scripts: {
          run: {
            backend: "npm run dev:backend",
          },
        },
      },
      status: {},
    });

    await act(async () => {
      fireEvent.click(screen.getByTitle("Run"));
      await Promise.resolve();
    });

    expect(onStart).toHaveBeenCalledWith("backend");
  });

  it("disconnects and disposes terminal on unmount", () => {
    const { onDisconnectOutput, unmount } = renderPanel({
      status: {
        setup: { state: "running" },
        run: { state: "idle" },
      },
    });

    act(() => {
      vi.advanceTimersByTime(60);
    });

    const terminal = state.terminals[0];
    if (!terminal) throw new Error("expected terminal to be created");

    unmount();

    expect(onDisconnectOutput).toHaveBeenCalled();
    expect(terminal.dispose).toHaveBeenCalledTimes(1);
  });
});
