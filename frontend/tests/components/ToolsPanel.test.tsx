import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  ToolOperation,
  ToolsResponse,
  ToolStatus,
} from "@hive/shared/setup-types";
import { ToolsPanel } from "@/components/setup/ToolsPanel";
import { createWrapper } from "../test-utils";

const mocks = vi.hoisted(() => ({
  getTools: vi.fn(),
  startOperation: vi.fn(),
  refreshModelCatalog: vi.fn(),
}));

vi.mock("@/lib/setup-api", () => ({
  createSetupApi: () => ({
    getTools: mocks.getTools,
    startOperation: mocks.startOperation,
  }),
}));

vi.mock("@/hooks/useModels", () => ({
  refreshModelCatalog: mocks.refreshModelCatalog,
}));

function tool(overrides: Partial<ToolStatus> & Pick<ToolStatus, "id">): ToolStatus {
  return {
    label: overrides.id,
    installed: false,
    version: null,
    latestVersion: null,
    updateAvailable: false,
    authenticated: false,
    managed: true,
    ...overrides,
  };
}

function operation(overrides: Partial<ToolOperation> & Pick<ToolOperation, "tool">): ToolOperation {
  return {
    id: "op-aaaaaaaaaa",
    kind: "install",
    status: "running",
    phase: "running",
    startedAt: "2026-07-27T00:00:00.000Z",
    ...overrides,
  };
}

function respond(response: Partial<ToolsResponse>): void {
  mocks.getTools.mockResolvedValue({ tools: [], operations: [], ...response });
}

function renderPanel() {
  const { wrapper } = createWrapper();
  return render(<ToolsPanel />, { wrapper });
}

beforeEach(() => {
  mocks.startOperation.mockResolvedValue({
    operation: operation({ tool: "claude" }),
    joined: false,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ToolsPanel", () => {
  it("renders each tool's installed state, version and sign-in state", async () => {
    respond({
      tools: [
        tool({
          id: "claude",
          label: "Claude Code",
          installed: true,
          version: "1.0.0",
          latestVersion: "1.0.0",
          authenticated: true,
        }),
        tool({ id: "codex", label: "Codex" }),
      ],
    });

    renderPanel();

    expect(await screen.findByRole("heading", { name: "Claude Code" })).toBeInTheDocument();
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
    expect(screen.getByText("Up to date")).toBeInTheDocument();
    expect(screen.getByText("Signed in")).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Codex" })).toBeInTheDocument();
    expect(screen.getByText("not installed")).toBeInTheDocument();
    expect(screen.getByText("Not installed")).toBeInTheDocument();
  });

  it("reports a tool as installed but unsigned-in without offering to sign it in", async () => {
    respond({
      tools: [tool({ id: "codex", label: "Codex", installed: true, version: "0.5.0" })],
    });

    renderPanel();

    expect(await screen.findByText("Not signed in")).toBeInTheDocument();
    // Signing in belongs to a later ticket; this panel must not pretend to.
    expect(screen.queryByRole("button", { name: /sign in/i })).not.toBeInTheDocument();
  });

  it("installs a missing tool", async () => {
    respond({ tools: [tool({ id: "claude", label: "Claude Code" })] });
    const user = userEvent.setup();

    renderPanel();
    await user.click(await screen.findByRole("button", { name: "Install" }));

    await waitFor(() => {
      expect(mocks.startOperation).toHaveBeenCalledWith("claude", "install");
    });
  });

  it("refreshes the model catalog when an install finishes, not when it starts", async () => {
    const running = operation({ tool: "claude" });
    respond({
      tools: [tool({ id: "claude", label: "Claude Code" })],
      operations: [running],
    });

    renderPanel();
    // Observed while running: the catalog is still the truth at this point.
    expect(await screen.findByText("Downloading and installing…")).toBeInTheDocument();
    expect(mocks.refreshModelCatalog).not.toHaveBeenCalled();

    respond({
      tools: [tool({ id: "claude", label: "Claude Code", installed: true, version: "1.0.0" })],
      operations: [{ ...running, status: "succeeded", phase: "done" }],
    });

    await waitFor(() => expect(mocks.refreshModelCatalog).toHaveBeenCalledTimes(1), {
      timeout: 5_000,
    });
  });

  it("does not refresh the catalog for an operation that finished before it mounted", async () => {
    respond({
      tools: [tool({ id: "claude", label: "Claude Code", installed: true, version: "1.0.0" })],
      operations: [operation({ tool: "claude", status: "succeeded", phase: "done" })],
    });

    renderPanel();

    expect(await screen.findByRole("heading", { name: "Claude Code" })).toBeInTheDocument();
    expect(mocks.refreshModelCatalog).not.toHaveBeenCalled();
  });

  it("offers an update only when one is available", async () => {
    respond({
      tools: [
        tool({
          id: "claude",
          label: "Claude Code",
          installed: true,
          version: "1.0.0",
          latestVersion: "1.2.0",
          updateAvailable: true,
        }),
        tool({ id: "codex", label: "Codex", installed: true, version: "0.5.0", latestVersion: "0.5.0" }),
      ],
    });
    const user = userEvent.setup();

    renderPanel();

    const buttons = await screen.findAllByRole("button", { name: "Update" });
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toBeEnabled();
    expect(buttons[1]).toBeDisabled();
    expect(screen.getByText("v1.0.0 → v1.2.0")).toBeInTheDocument();

    await user.click(buttons[0]);
    await waitFor(() => {
      expect(mocks.startOperation).toHaveBeenCalledWith("claude", "update");
    });
  });

  it("shows progress for an operation already running on the server", async () => {
    // The panel was mounted after the install started — a reload, or a client
    // that navigated away and came back — and still has to show it.
    respond({
      tools: [tool({ id: "claude", label: "Claude Code" })],
      operations: [operation({ tool: "claude", phase: "running" })],
    });

    renderPanel();

    expect(await screen.findByText("Downloading and installing…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install" })).toBeDisabled();
  });

  it("renders a typed failure reason with the command output", async () => {
    respond({
      tools: [tool({ id: "claude", label: "Claude Code" })],
      operations: [
        operation({
          tool: "claude",
          status: "failed",
          phase: "done",
          finishedAt: "2026-07-27T00:01:00.000Z",
          failure: {
            reason: "network",
            message: "Claude Code install failed (exit 1).",
            outputExcerpt: "npm error code ENOTFOUND",
          },
        }),
      ],
    });

    renderPanel();

    expect(await screen.findByText("Claude Code install failed")).toBeInTheDocument();
    expect(
      screen.getByText(/could not reach the package registry/i),
    ).toBeInTheDocument();
    expect(screen.getByText("npm error code ENOTFOUND")).toBeInTheDocument();
  });

  it("tells the operator what to do when Hive restarted mid-install", async () => {
    respond({
      tools: [tool({ id: "claude", label: "Claude Code" })],
      operations: [
        operation({
          tool: "claude",
          status: "failed",
          phase: "done",
          failure: { reason: "interrupted", message: "Hive restarted." },
        }),
      ],
    });

    renderPanel();

    expect(await screen.findByText(/Hive restarted while this was running/i)).toBeInTheDocument();
    // Recoverable: the action is offered again rather than left stuck.
    expect(screen.getByRole("button", { name: "Install" })).toBeEnabled();
  });

  it("reports a tool it does not manage instead of offering a broken action", async () => {
    respond({
      tools: [tool({ id: "gh", label: "GitHub CLI", installed: true, version: "2.62.0", managed: false })],
    });

    renderPanel();

    expect(await screen.findByText(/checksum-pinned release/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("surfaces a status failure instead of rendering an empty panel", async () => {
    mocks.getTools.mockRejectedValue(new Error("401 Unauthorized"));

    renderPanel();

    expect(await screen.findByText(/Could not read tool status/)).toBeInTheDocument();
  });

  it("writes no command output or token to browser storage", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    respond({
      tools: [tool({ id: "claude", label: "Claude Code" })],
      operations: [
        operation({
          tool: "claude",
          status: "failed",
          phase: "done",
          failure: { reason: "command_failed", message: "boom", outputExcerpt: "secret-looking output" },
        }),
      ],
    });
    const user = userEvent.setup();

    renderPanel();
    await user.click(await screen.findByRole("button", { name: "Install" }));
    await waitFor(() => expect(mocks.startOperation).toHaveBeenCalled());

    expect(localSetItem).not.toHaveBeenCalled();
    localSetItem.mockRestore();
  });
});
