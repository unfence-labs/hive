import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ToolAuthSession } from "@hive/shared/setup-types";
import { GithubCard } from "@/components/setup/GithubCard";
import { createWrapper } from "../test-utils";

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  startAuth: vi.fn(),
  cancelAuth: vi.fn(),
  getAccountStatus: vi.fn(),
  disconnectAccount: vi.fn(),
  openExternal: vi.fn(),
}));

vi.mock("@/lib/setup-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/setup-api")>()),
  createSetupApi: () => ({
    getStatus: mocks.getStatus,
    startAuth: mocks.startAuth,
    cancelAuth: mocks.cancelAuth,
    getAccountStatus: mocks.getAccountStatus,
    disconnectAccount: mocks.disconnectAccount,
  }),
}));

vi.mock("@/lib/open-external", () => ({
  openExternal: mocks.openExternal,
}));

function ghSession(overrides: Partial<ToolAuthSession> = {}): ToolAuthSession {
  return {
    tool: "gh",
    state: "awaiting_authorization",
    verificationUri: "https://github.com/login/device",
    userCode: "ABCD-1234",
    needsCode: false,
    startedAt: "2026-07-27T00:00:00.000Z",
    ...overrides,
  };
}

function renderCard() {
  const { wrapper } = createWrapper();
  return render(<GithubCard />, { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getStatus.mockResolvedValue({ operations: [], authSessions: [] });
  mocks.startAuth.mockResolvedValue(ghSession({ state: "starting" }));
  mocks.cancelAuth.mockResolvedValue(ghSession({ state: "cancelled" }));
});

describe("GithubCard", () => {
  it("shows the connected account", async () => {
    mocks.getAccountStatus.mockResolvedValue({
      ghInstalled: true,
      authenticated: true,
      user: { login: "octocat", name: "Mona Lisa", email: "", avatarUrl: "" },
    });

    renderCard();

    expect(await screen.findByText(/Signed in/)).toBeInTheDocument();
    expect(screen.getByText(/octocat/)).toBeInTheDocument();
    // Signing an account out belongs to Settings, not to the installer.
    expect(screen.queryByRole("button", { name: /disconnect/i })).not.toBeInTheDocument();
  });

  it("starts the sign-in and shows the code the server produced", async () => {
    const user = userEvent.setup();
    mocks.getAccountStatus.mockResolvedValue({ ghInstalled: true, authenticated: false });
    mocks.getStatus
      .mockResolvedValueOnce({ operations: [], authSessions: [] })
      .mockResolvedValue({ operations: [], authSessions: [ghSession()] });

    renderCard();
    await screen.findByText("Not signed in");

    await user.click(screen.getByRole("button", { name: "Connect GitHub" }));

    expect(mocks.startAuth).toHaveBeenCalledWith("gh");
    expect(await screen.findByText("ABCD-1234")).toBeInTheDocument();
  });

  it("cancels a sign-in that is under way", async () => {
    const user = userEvent.setup();
    mocks.getAccountStatus.mockResolvedValue({ ghInstalled: true, authenticated: false });
    mocks.getStatus.mockResolvedValue({ operations: [], authSessions: [ghSession()] });

    renderCard();
    await screen.findByText("ABCD-1234");

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mocks.cancelAuth).toHaveBeenCalledWith("gh");
    await waitFor(() => {
      expect(screen.getByText("Not signed in")).toBeInTheDocument();
    });
  });

  it("reports a failed sign-in and keeps the connect action", async () => {
    mocks.getAccountStatus.mockResolvedValue({ ghInstalled: true, authenticated: false });
    mocks.getStatus
      .mockResolvedValueOnce({ operations: [], authSessions: [ghSession()] })
      .mockResolvedValue({
        operations: [],
        authSessions: [
          ghSession({
            state: "failed",
            failure: { reason: "command_failed", message: "Signing the GitHub CLI in failed." },
          }),
        ],
      });

    renderCard();
    await screen.findByText("ABCD-1234");

    await waitFor(
      () => {
        expect(screen.getByRole("alert")).toHaveTextContent(/Signing the GitHub CLI in failed/);
      },
      { timeout: 4000 },
    );
    expect(screen.getByRole("button", { name: "Connect GitHub" })).toBeInTheDocument();
  });

  it("offers no sign-in when the GitHub CLI is missing", async () => {
    mocks.getAccountStatus.mockResolvedValue({ ghInstalled: false, authenticated: false });

    renderCard();

    expect(await screen.findByText("GitHub CLI not installed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect GitHub" })).not.toBeInTheDocument();
  });
});
