import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  ToolAuthSession,
  ToolOperation,
  ToolsResponse,
  ToolStatus,
} from "@hive/shared/setup-types";
import { ToolsPanel } from "@/components/setup/ToolsPanel";
import { createWrapper } from "../test-utils";

const mocks = vi.hoisted(() => ({
  getTools: vi.fn(),
  getStatus: vi.fn(),
  startOperation: vi.fn(),
  startAuth: vi.fn(),
  submitAuthCode: vi.fn(),
  cancelAuth: vi.fn(),
  refreshModelCatalog: vi.fn(),
}));

vi.mock("@/lib/setup-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/setup-api")>()),
  createSetupApi: () => ({
    getTools: mocks.getTools,
    getStatus: mocks.getStatus,
    startOperation: mocks.startOperation,
    startAuth: mocks.startAuth,
    submitAuthCode: mocks.submitAuthCode,
    cancelAuth: mocks.cancelAuth,
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
  const full: ToolsResponse = {
    tools: [],
    operations: [],
    authSessions: [],
    ...response,
  };
  mocks.getTools.mockResolvedValue(full);
  // Progress is read from the cheap status endpoint; serve the same view.
  mocks.getStatus.mockResolvedValue({
    operations: full.operations,
    authSessions: full.authSessions,
  });
}

function renderPanel() {
  const { wrapper } = createWrapper();
  return render(<ToolsPanel />, { wrapper });
}

beforeEach(() => {
  mocks.getStatus.mockResolvedValue({ operations: [], authSessions: [] });
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
    expect(screen.getByText("Signed in")).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Codex" })).toBeInTheDocument();
    expect(screen.getByText("not installed")).toBeInTheDocument();
  });

  it("offers to sign in a tool that is installed but not signed in", async () => {
    respond({
      tools: [tool({ id: "codex", label: "Codex", installed: true, version: "0.5.0" })],
    });

    renderPanel();

    expect(await screen.findByText("Not signed in")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect Codex" })).toBeEnabled();
  });

  it("does not offer to connect a tool that is not installed yet", async () => {
    respond({ tools: [tool({ id: "codex", label: "Codex", installed: false })] });

    renderPanel();

    expect(await screen.findByText("not installed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect Codex" })).not.toBeInTheDocument();
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

    // One Update button, on the tool that has an update; a current tool
    // offers nothing rather than a dead control.
    const button = await screen.findByRole("button", { name: "Update" });
    expect(button).toBeEnabled();
    // The target version rides on the update pill, next to the current one.
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
    expect(screen.getByText("v1.2.0")).toBeInTheDocument();

    await user.click(button);
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

  it("renders only agent harnesses, not the gh the server also reports", async () => {
    respond({
      tools: [
        tool({ id: "claude", label: "Claude Code", installed: true, version: "1.0.0" }),
        tool({ id: "gh", label: "GitHub CLI", installed: true, version: "2.62.0", managed: false }),
      ],
    });

    renderPanel();

    // GitHub is not a harness; its account lives in Settings → Account.
    expect(await screen.findByRole("heading", { name: "Claude Code" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "GitHub CLI" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect GitHub" })).not.toBeInTheDocument();
  });

  it("shows an update request that never started in the same error panel", async () => {
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
      ],
    });
    mocks.startOperation.mockRejectedValue(new Error("Internal Server Error"));
    const user = userEvent.setup();

    renderPanel();
    await user.click(await screen.findByRole("button", { name: "Update" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Internal Server Error");
    // The failed request is over: retrying must not wait on anything.
    expect(screen.getByRole("button", { name: "Update" })).toBeEnabled();
  });

  it("hides a stale failure the moment another action starts", async () => {
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
      ],
      operations: [
        operation({
          tool: "claude",
          kind: "update",
          status: "failed",
          phase: "done",
          failure: { reason: "network", message: "Claude Code update failed (exit 1)." },
        }),
      ],
    });
    const user = userEvent.setup();

    renderPanel();
    expect(await screen.findByText("Claude Code update failed")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Update" }));

    // The retry is the acknowledgement: the old failure has been acted on.
    expect(screen.queryByText("Claude Code update failed")).not.toBeInTheDocument();
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

// ── Sign-in ──────────────────────────────────────────────────────────

function session(
  overrides: Partial<ToolAuthSession> & Pick<ToolAuthSession, "tool" | "state">,
): ToolAuthSession {
  return {
    needsCode: false,
    startedAt: "2026-07-27T00:00:00.000Z",
    ...overrides,
  };
}

describe("ToolsPanel sign-in", () => {
  it("offers a connect action for a tool that is installed but not signed in", async () => {
    respond({
      tools: [tool({ id: "codex", label: "Codex", installed: true, authenticated: false })],
    });
    mocks.startAuth.mockResolvedValue(session({ tool: "codex", state: "starting" }));
    const user = userEvent.setup();

    renderPanel();
    await user.click(await screen.findByRole("button", { name: "Connect Codex" }));

    expect(mocks.startAuth).toHaveBeenCalledWith("codex");
  });

  it("shows the code and link the server recovered from the CLI", async () => {
    respond({
      tools: [tool({ id: "codex", label: "Codex", installed: true })],
      authSessions: [
        session({
          tool: "codex",
          state: "awaiting_authorization",
          verificationUri: "https://auth.openai.com/codex/device",
          userCode: "U927-TJEHB",
        }),
      ],
    });

    renderPanel();

    expect(await screen.findByText("U927-TJEHB")).toBeInTheDocument();
    expect(screen.getByText("Waiting for authorization…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open sign-in page/i })).toBeInTheDocument();
  });

  it("asks for the code back when the flow needs one, and submits it", async () => {
    respond({
      tools: [tool({ id: "claude", label: "Claude Code", installed: true })],
      authSessions: [
        session({
          tool: "claude",
          state: "awaiting_code",
          needsCode: true,
          verificationUri: "https://claude.com/cai/oauth/authorize?state=abc",
        }),
      ],
    });
    mocks.submitAuthCode.mockResolvedValue(session({ tool: "claude", state: "verifying" }));
    const user = userEvent.setup();

    renderPanel();

    const input = await screen.findByLabelText(/paste the code/i);
    await user.type(input, "auth-code-123");
    await user.click(screen.getByRole("button", { name: "Finish" }));

    expect(mocks.submitAuthCode).toHaveBeenCalledWith("claude", "auth-code-123");
  });

  it("keeps the operator at the prompt when the provider refused their code", async () => {
    respond({
      tools: [tool({ id: "claude", label: "Claude Code", installed: true })],
      authSessions: [
        session({
          tool: "claude",
          state: "awaiting_code",
          needsCode: true,
          verificationUri: "https://claude.com/cai/oauth/authorize?state=abc",
          notice: "Invalid code. Please make sure the full code was copied",
        }),
      ],
    });

    renderPanel();

    expect(
      await screen.findByText("Invalid code. Please make sure the full code was copied"),
    ).toBeInTheDocument();
    // Still a live prompt, not a dead session: there is a code box to try again in.
    expect(screen.getByLabelText(/paste the code/i)).toBeInTheDocument();
  });

  it("re-signs a connected tool without asking first", async () => {
    respond({
      tools: [tool({ id: "codex", label: "Codex", installed: true, authenticated: true })],
    });
    mocks.startAuth.mockResolvedValue(session({ tool: "codex", state: "starting" }));
    const user = userEvent.setup();

    renderPanel();
    await user.click(await screen.findByRole("button", { name: "Sign in again" }));

    // No confirmation step: the flows back a working credential up and restore
    // it when the new sign-in ends any way but connected.
    expect(mocks.startAuth).toHaveBeenCalledWith("codex");
  });

  it("says nothing about a sign-in the operator cancelled", async () => {
    respond({
      tools: [tool({ id: "codex", label: "Codex", installed: true })],
      authSessions: [session({ tool: "codex", state: "cancelled" })],
    });

    renderPanel();

    // The operator did the cancelling; there is nothing to explain.
    expect(await screen.findByRole("button", { name: "Connect Codex" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports an expired code as expired rather than as a failure", async () => {
    respond({
      tools: [tool({ id: "codex", label: "Codex", installed: true })],
      authSessions: [session({ tool: "codex", state: "expired" })],
    });

    renderPanel();

    expect(await screen.findByText(/code expired before it was confirmed/i)).toBeInTheDocument();
    // Still offered, because trying again is the fix.
    expect(screen.getByRole("button", { name: "Connect Codex" })).toBeEnabled();
  });

  it("reports a CLI that is too old, with what to do about it", async () => {
    respond({
      tools: [tool({ id: "codex", label: "Codex", installed: true, version: "0.90.0" })],
      authSessions: [
        session({
          tool: "codex",
          state: "failed",
          failure: {
            reason: "unsupported_cli",
            message: "Codex 0.90.0 does not support device sign-in.",
            outputExcerpt: "unknown flag --device-auth",
          },
        }),
      ],
    });

    renderPanel();

    expect(
      await screen.findByText(/Codex 0\.90\.0 does not support device sign-in/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/too old for this sign-in flow/i)).toBeInTheDocument();
    expect(screen.getByText("unknown flag --device-auth")).toBeInTheDocument();
  });

  it("never gates one agent harness on the other", async () => {
    respond({
      tools: [
        tool({ id: "claude", label: "Claude Code", installed: true, authenticated: true }),
        tool({ id: "codex", label: "Codex", installed: true, authenticated: false }),
      ],
    });

    renderPanel();

    // Connecting the second is offered, never demanded.
    expect(await screen.findByRole("button", { name: "Connect Codex" })).toBeEnabled();
    // The panel renders cards; stating the requirement is the host page's job,
    // so it is not repeated here. See tests/pages/AgentSettings.test.tsx.
    expect(screen.queryByText(/harness needed to run Hive/i)).not.toBeInTheDocument();
  });

  it("cancels a running sign-in", async () => {
    respond({
      tools: [tool({ id: "claude", label: "Claude Code", installed: true })],
      authSessions: [
        session({
          tool: "claude",
          state: "awaiting_code",
          needsCode: true,
          verificationUri: "https://claude.com/x",
        }),
      ],
    });
    mocks.cancelAuth.mockResolvedValue(session({ tool: "claude", state: "cancelled" }));
    const user = userEvent.setup();

    renderPanel();
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(mocks.cancelAuth).toHaveBeenCalledWith("claude");
  });
});
