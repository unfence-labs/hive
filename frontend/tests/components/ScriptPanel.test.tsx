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
  const onConnectOutput = overrides?.onConnectOutput ?? vi.fn();
  const onDisconnectOutput = overrides?.onDisconnectOutput ?? vi.fn();

  const defaultProps: ComponentProps<typeof ScriptPanel> = {
    config: {
      scripts: {
        setup: "npm ci",
      },
    },
    status: {
      setup: { state: "idle" },
      run: { state: "idle" },
    },
    onStart,
    onStop,
    onConnectOutput,
    onDisconnectOutput,
  };

  const utils = render(<ScriptPanel {...defaultProps} {...overrides} />);
  return { ...utils, onStart, onStop, onConnectOutput, onDisconnectOutput };
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

  it("renders nothing when no scripts are defined", () => {
    const { container } = renderPanel({
      config: {},
    });

    expect(container).toBeEmptyDOMElement();
  });

  it("starts setup script from idle state", async () => {
    const { onStart } = renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByTitle("Run setup"));
      await Promise.resolve();
    });

    expect(onStart).toHaveBeenCalledWith("setup");
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
          run: "npm run dev",
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
          run: "npm run dev",
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
