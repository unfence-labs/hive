import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SetupStatusResponse, ToolAuthSession } from "@hive/shared/setup-types";
import AccountSettings from "@/pages/settings/AccountSettings";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  openExternal: vi.fn(),
  copyToClipboard: vi.fn(),
  getStatus: vi.fn(),
  startAuth: vi.fn(),
  cancelAuth: vi.fn(),
}));

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: mocks.get,
    post: mocks.post,
  },
}));

vi.mock("@/lib/open-external", () => ({
  openExternal: mocks.openExternal,
}));

vi.mock("@/lib/clipboard", () => ({
  copyToClipboard: mocks.copyToClipboard,
}));

vi.mock("@/lib/setup-api", () => ({
  createSetupApi: () => ({
    getStatus: mocks.getStatus,
    startAuth: mocks.startAuth,
    cancelAuth: mocks.cancelAuth,
  }),
}));

function createAccountWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, Wrapper };
}

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

function status(sessions: ToolAuthSession[]): SetupStatusResponse {
  return { operations: [], authSessions: sessions };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mocks.copyToClipboard.mockResolvedValue(undefined);
  mocks.getStatus.mockResolvedValue(status([]));
  mocks.startAuth.mockResolvedValue(ghSession({ state: "starting" }));
  mocks.cancelAuth.mockResolvedValue(ghSession({ state: "cancelled" }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AccountSettings", () => {
  it("renders a loading spinner during initial loading state", () => {
    mocks.get.mockReturnValue(new Promise(() => {}));
    const { Wrapper } = createAccountWrapper();

    render(<AccountSettings />, { wrapper: Wrapper });

    expect(screen.getByText("Account")).toBeInTheDocument();
    expect(screen.queryByText("Not connected")).not.toBeInTheDocument();
    expect(screen.queryByText("GitHub CLI not found")).not.toBeInTheDocument();
  });

  it("shows 'no-gh' state when ghInstalled is false", async () => {
    mocks.get.mockResolvedValue({ ghInstalled: false, authenticated: false });
    const { Wrapper } = createAccountWrapper();

    render(<AccountSettings />, { wrapper: Wrapper });

    expect(await screen.findByText("GitHub CLI not found")).toBeInTheDocument();
    expect(screen.getByText(/Install GitHub CLI/)).toBeInTheDocument();
  });

  it("opens cli.github.com link from no-gh state", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mocks.get.mockResolvedValue({ ghInstalled: false, authenticated: false });
    const { Wrapper } = createAccountWrapper();

    render(<AccountSettings />, { wrapper: Wrapper });

    await screen.findByText("GitHub CLI not found");
    await user.click(screen.getByText("Install GitHub CLI"));

    expect(mocks.openExternal).toHaveBeenCalledWith("https://cli.github.com");
  });

  it("shows disconnected state with Connect button", async () => {
    mocks.get.mockResolvedValue({ ghInstalled: true, authenticated: false });
    const { Wrapper } = createAccountWrapper();

    render(<AccountSettings />, { wrapper: Wrapper });

    expect(await screen.findByText("Not connected")).toBeInTheDocument();
    expect(screen.getByText("Connect with GitHub")).toBeInTheDocument();
  });

  it("shows connected state with user info", async () => {
    mocks.get.mockResolvedValue({
      ghInstalled: true,
      authenticated: true,
      user: {
        login: "octocat",
        name: "Mona Lisa",
        email: "octocat@github.com",
        avatarUrl: "https://avatars.githubusercontent.com/u/1",
      },
    });
    const { Wrapper } = createAccountWrapper();

    render(<AccountSettings />, { wrapper: Wrapper });

    expect(await screen.findByText("Mona Lisa")).toBeInTheDocument();
    expect(screen.getByText("octocat@github.com")).toBeInTheDocument();
    expect(screen.getByText("octocat")).toBeInTheDocument();
    expect(screen.getByText("Disconnect")).toBeInTheDocument();
  });

  it("shows user login as name when name is empty", async () => {
    mocks.get.mockResolvedValue({
      ghInstalled: true,
      authenticated: true,
      user: { login: "bot-user", name: "", email: "", avatarUrl: "" },
    });
    const { Wrapper } = createAccountWrapper();

    render(<AccountSettings />, { wrapper: Wrapper });

    const heading = await screen.findByRole("heading", { level: 2, name: "bot-user" });
    expect(heading.textContent).toBe("bot-user");
  });

  it("shows error state when backend is unreachable", async () => {
    mocks.get.mockRejectedValue(new Error("fetch failed"));
    const { Wrapper } = createAccountWrapper();

    render(<AccountSettings />, { wrapper: Wrapper });

    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Could not reach backend")).toBeInTheDocument();
    expect(screen.getByText("Try again")).toBeInTheDocument();
  });

  // -- Connect flow --

  it("starts the server-driven sign-in and shows the code it produced", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mocks.get.mockResolvedValue({ ghInstalled: true, authenticated: false });
    mocks.getStatus
      .mockResolvedValueOnce(status([]))
      .mockResolvedValue(status([ghSession()]));
    const { Wrapper } = createAccountWrapper();

    render(<AccountSettings />, { wrapper: Wrapper });
    await screen.findByText("Connect with GitHub");

    await user.click(screen.getByText("Connect with GitHub"));

    expect(mocks.startAuth).toHaveBeenCalledWith("gh");
    expect(await screen.findByText("ABCD-1234")).toBeInTheDocument();
    expect(screen.getByText("Waiting for authorization…")).toBeInTheDocument();
  });

  it("resumes a sign-in still running on the server after a reload", async () => {
    mocks.get.mockResolvedValue({ ghInstalled: true, authenticated: false });
    mocks.getStatus.mockResolvedValue(status([ghSession()]));
    const { Wrapper } = createAccountWrapper();

    render(<AccountSettings />, { wrapper: Wrapper });

    // No click: the server still holds the flow, so the code comes back.
    expect(await screen.findByText("ABCD-1234")).toBeInTheDocument();
    expect(mocks.startAuth).not.toHaveBeenCalled();
  });

  it("copies device code with clipboard helper and toggles copy label", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mocks.get.mockResolvedValue({ ghInstalled: true, authenticated: false });
    mocks.getStatus.mockResolvedValue(status([ghSession({ userCode: "COPY-CODE" })]));
    const { Wrapper } = createAccountWrapper();

    render(<AccountSettings />, { wrapper: Wrapper });
    await screen.findByText("COPY-CODE");

    await user.click(screen.getByLabelText("Copy code to clipboard"));

    expect(mocks.copyToClipboard).toHaveBeenCalledWith("COPY-CODE");
    expect(screen.getByLabelText("Code copied")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByLabelText("Copy code to clipboard")).toBeInTheDocument();
  });

  it("opens GitHub verification URL", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mocks.get.mockResolvedValue({ ghInstalled: true, authenticated: false });
    mocks.getStatus.mockResolvedValue(status([ghSession({ userCode: "TEST-CODE" })]));
    const { Wrapper } = createAccountWrapper();

    render(<AccountSettings />, { wrapper: Wrapper });
    await screen.findByText("TEST-CODE");

    await user.click(screen.getByRole("button", { name: /open sign-in page/i }));

    expect(mocks.openExternal).toHaveBeenCalledWith("https://github.com/login/device");
  });

  it("transitions to connected once the server reports the sign-in landed", async () => {
    mocks.get
      .mockResolvedValueOnce({ ghInstalled: true, authenticated: false })
      .mockResolvedValue({
        ghInstalled: true,
        authenticated: true,
        user: { login: "octocat", name: "Mona Lisa", email: "", avatarUrl: "" },
      });
    mocks.getStatus
      .mockResolvedValueOnce(status([ghSession()]))
      .mockResolvedValue(status([ghSession({ state: "connected" })]));
    const { Wrapper } = createAccountWrapper();

    render(<AccountSettings />, { wrapper: Wrapper });
    await screen.findByText("ABCD-1234");

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    await waitFor(() => {
      expect(screen.getByText("Mona Lisa")).toBeInTheDocument();
    });
  });

  it("shows an error when the code expires", async () => {
    mocks.get.mockResolvedValue({ ghInstalled: true, authenticated: false });
    mocks.getStatus
      .mockResolvedValueOnce(status([ghSession()]))
      .mockResolvedValue(status([ghSession({ state: "expired" })]));
    const { Wrapper } = createAccountWrapper();

    render(<AccountSettings />, { wrapper: Wrapper });
    await screen.findByText("ABCD-1234");

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    await waitFor(() => {
      expect(screen.getByText(/code expired before it was confirmed/i)).toBeInTheDocument();
    });
  });

  it("shows the failure and its hint when the sign-in fails", async () => {
    mocks.get.mockResolvedValue({ ghInstalled: true, authenticated: false });
    mocks.getStatus
      .mockResolvedValueOnce(status([ghSession()]))
      .mockResolvedValue(
        status([
          ghSession({
            state: "failed",
            failure: { reason: "command_failed", message: "Signing the GitHub CLI in failed." },
          }),
        ]),
      );
    const { Wrapper } = createAccountWrapper();

    render(<AccountSettings />, { wrapper: Wrapper });
    await screen.findByText("ABCD-1234");

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    await waitFor(() => {
      expect(screen.getByText(/Signing the GitHub CLI in failed/)).toBeInTheDocument();
    });
  });

  it("cancels the sign-in on the server and returns to disconnected", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mocks.get.mockResolvedValue({ ghInstalled: true, authenticated: false });
    mocks.getStatus
      .mockResolvedValueOnce(status([ghSession()]))
      .mockResolvedValue(status([ghSession({ state: "cancelled" })]));
    const { Wrapper } = createAccountWrapper();

    render(<AccountSettings />, { wrapper: Wrapper });
    await screen.findByText("ABCD-1234");

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mocks.cancelAuth).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText("Not connected")).toBeInTheDocument();
    });
  });

  // -- Disconnect flow --

  it("disconnects and returns to disconnected state", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mocks.get.mockResolvedValue({
      ghInstalled: true,
      authenticated: true,
      user: { login: "octocat", name: "Mona Lisa", email: "", avatarUrl: "" },
    });
    const { Wrapper } = createAccountWrapper();

    render(<AccountSettings />, { wrapper: Wrapper });
    await screen.findByText("Mona Lisa");

    mocks.post.mockResolvedValueOnce({ ok: true });

    await user.click(screen.getByText("Disconnect"));

    await waitFor(() => {
      expect(screen.getByText("Not connected")).toBeInTheDocument();
    });
  });

  it("stays connected when disconnect fails", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mocks.get.mockResolvedValue({
      ghInstalled: true,
      authenticated: true,
      user: { login: "octocat", name: "Mona Lisa", email: "", avatarUrl: "" },
    });
    const { Wrapper } = createAccountWrapper();

    render(<AccountSettings />, { wrapper: Wrapper });
    await screen.findByText("Mona Lisa");

    mocks.post.mockRejectedValueOnce(new Error("server error"));

    await user.click(screen.getByText("Disconnect"));

    await waitFor(() => {
      expect(screen.getByText("Mona Lisa")).toBeInTheDocument();
    });
  });

  // -- Retry flow --

  it("retries status check from error state", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mocks.get.mockRejectedValueOnce(new Error("network error"));
    const { Wrapper } = createAccountWrapper();

    render(<AccountSettings />, { wrapper: Wrapper });
    await screen.findByText("Try again");

    mocks.get.mockResolvedValueOnce({ ghInstalled: true, authenticated: false });

    await user.click(screen.getByText("Try again"));

    await waitFor(() => {
      expect(screen.getByText("Not connected")).toBeInTheDocument();
    });
  });
});
