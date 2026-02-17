import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AccountSettings from "@/pages/settings/AccountSettings";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  openExternal: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Loading / status check states ────────────────────────────────────

describe("AccountSettings", () => {
  it("renders a loading spinner during initial loading state", () => {
    // Never resolve the GET call
    mocks.get.mockReturnValue(new Promise(() => {}));

    render(<AccountSettings />);
    // The component shows a spinner while loading
    expect(screen.getByText("Account")).toBeInTheDocument();
    expect(screen.queryByText("Not connected")).not.toBeInTheDocument();
    expect(screen.queryByText("GitHub CLI not found")).not.toBeInTheDocument();
  });

  it("shows 'no-gh' state when ghInstalled is false", async () => {
    mocks.get.mockResolvedValue({ ghInstalled: false, authenticated: false });

    render(<AccountSettings />);

    expect(await screen.findByText("GitHub CLI not found")).toBeInTheDocument();
    expect(screen.getByText(/Install GitHub CLI/)).toBeInTheDocument();
  });

  it("opens cli.github.com link from no-gh state", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mocks.get.mockResolvedValue({ ghInstalled: false, authenticated: false });

    render(<AccountSettings />);

    await screen.findByText("GitHub CLI not found");
    await user.click(screen.getByText("Install GitHub CLI"));

    expect(mocks.openExternal).toHaveBeenCalledWith("https://cli.github.com");
  });

  it("shows disconnected state with Connect button", async () => {
    mocks.get.mockResolvedValue({ ghInstalled: true, authenticated: false });

    render(<AccountSettings />);

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

    render(<AccountSettings />);

    expect(await screen.findByText("Mona Lisa")).toBeInTheDocument();
    expect(screen.getByText("octocat@github.com")).toBeInTheDocument();
    expect(screen.getByText("octocat")).toBeInTheDocument();
    expect(screen.getByText("Disconnect")).toBeInTheDocument();
  });

  it("shows user login as name when name is empty", async () => {
    mocks.get.mockResolvedValue({
      ghInstalled: true,
      authenticated: true,
      user: {
        login: "bot-user",
        name: "",
        email: "",
        avatarUrl: "",
      },
    });

    render(<AccountSettings />);

    // The h2 should contain the login since name is empty
    const heading = await screen.findByRole("heading", { level: 2, name: "bot-user" });
    expect(heading.textContent).toBe("bot-user");
  });

  it("shows error state when backend is unreachable", async () => {
    mocks.get.mockRejectedValue(new Error("fetch failed"));

    render(<AccountSettings />);

    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Could not reach backend")).toBeInTheDocument();
    expect(screen.getByText("Try again")).toBeInTheDocument();
  });

  // ── Connect flow ────────────────────────────────────────────────────

  it("starts device flow and shows user code", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mocks.get.mockResolvedValue({ ghInstalled: true, authenticated: false });

    render(<AccountSettings />);

    await screen.findByText("Connect with GitHub");

    mocks.post.mockResolvedValueOnce({
      userCode: "ABCD-1234",
      verificationUri: "https://github.com/login/device",
      expiresIn: 900,
      interval: 5,
    });
    // Mock poll to stay pending
    mocks.post.mockResolvedValue({ status: "pending" });

    await user.click(screen.getByText("Connect with GitHub"));

    expect(await screen.findByText("ABCD-1234")).toBeInTheDocument();
    expect(screen.getByText("Waiting for authorization...")).toBeInTheDocument();
  });

  it("renders copy button alongside user code in connecting state", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mocks.get.mockResolvedValue({ ghInstalled: true, authenticated: false });

    render(<AccountSettings />);
    await screen.findByText("Connect with GitHub");

    mocks.post.mockResolvedValueOnce({
      userCode: "COPY-ME",
      verificationUri: "https://github.com/login/device",
      expiresIn: 900,
      interval: 5,
    });
    mocks.post.mockResolvedValue({ status: "pending" });

    await user.click(screen.getByText("Connect with GitHub"));
    await screen.findByText("COPY-ME");

    // The code block is a clickable button with copy label
    expect(screen.getByLabelText("Copy code to clipboard")).toBeInTheDocument();
  });

  it("opens GitHub verification URL", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mocks.get.mockResolvedValue({ ghInstalled: true, authenticated: false });

    render(<AccountSettings />);
    await screen.findByText("Connect with GitHub");

    mocks.post.mockResolvedValueOnce({
      userCode: "TEST-CODE",
      verificationUri: "https://github.com/login/device",
      expiresIn: 900,
      interval: 5,
    });
    mocks.post.mockResolvedValue({ status: "pending" });

    await user.click(screen.getByText("Connect with GitHub"));
    await screen.findByText("TEST-CODE");
    await user.click(screen.getByText("Open GitHub"));

    expect(mocks.openExternal).toHaveBeenCalledWith("https://github.com/login/device");
  });

  it("transitions to connected after successful poll", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mocks.get.mockResolvedValue({ ghInstalled: true, authenticated: false });

    render(<AccountSettings />);
    await screen.findByText("Connect with GitHub");

    mocks.post.mockResolvedValueOnce({
      userCode: "FLOW-CODE",
      verificationUri: "https://github.com/login/device",
      expiresIn: 900,
      interval: 1,
    });

    // First poll: pending, second poll: complete
    mocks.post
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({
        status: "complete",
        user: {
          login: "octocat",
          name: "Mona Lisa",
          email: "octocat@github.com",
          avatarUrl: "",
        },
      });

    await user.click(screen.getByText("Connect with GitHub"));
    await screen.findByText("FLOW-CODE");

    // Advance past poll interval
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    // Advance past second poll
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(screen.getByText("Mona Lisa")).toBeInTheDocument();
    });
  });

  it("shows error when connect flow initiation fails", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mocks.get.mockResolvedValue({ ghInstalled: true, authenticated: false });

    render(<AccountSettings />);
    await screen.findByText("Connect with GitHub");

    mocks.post.mockRejectedValueOnce(new Error("network error"));

    await user.click(screen.getByText("Connect with GitHub"));

    expect(await screen.findByText("Failed to start GitHub connection flow")).toBeInTheDocument();
  });

  it("shows error on expired poll status", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mocks.get.mockResolvedValue({ ghInstalled: true, authenticated: false });

    render(<AccountSettings />);
    await screen.findByText("Connect with GitHub");

    mocks.post.mockResolvedValueOnce({
      userCode: "EXP-CODE",
      verificationUri: "https://github.com/login/device",
      expiresIn: 900,
      interval: 1,
    });
    mocks.post.mockResolvedValueOnce({ status: "expired" });

    await user.click(screen.getByText("Connect with GitHub"));
    await screen.findByText("EXP-CODE");

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(screen.getByText("Authorization timed out. Please try again.")).toBeInTheDocument();
    });
  });

  it("shows error on denied poll status", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mocks.get.mockResolvedValue({ ghInstalled: true, authenticated: false });

    render(<AccountSettings />);
    await screen.findByText("Connect with GitHub");

    mocks.post.mockResolvedValueOnce({
      userCode: "DENY-CODE",
      verificationUri: "https://github.com/login/device",
      expiresIn: 900,
      interval: 1,
    });
    mocks.post.mockResolvedValueOnce({ status: "denied" });

    await user.click(screen.getByText("Connect with GitHub"));
    await screen.findByText("DENY-CODE");

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(screen.getByText("Authorization was denied.")).toBeInTheDocument();
    });
  });

  // ── Disconnect flow ─────────────────────────────────────────────────

  it("disconnects and returns to disconnected state", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mocks.get.mockResolvedValue({
      ghInstalled: true,
      authenticated: true,
      user: {
        login: "octocat",
        name: "Mona Lisa",
        email: "",
        avatarUrl: "",
      },
    });

    render(<AccountSettings />);
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
      user: {
        login: "octocat",
        name: "Mona Lisa",
        email: "",
        avatarUrl: "",
      },
    });

    render(<AccountSettings />);
    await screen.findByText("Mona Lisa");

    mocks.post.mockRejectedValueOnce(new Error("server error"));

    await user.click(screen.getByText("Disconnect"));

    // Should remain connected
    await waitFor(() => {
      expect(screen.getByText("Mona Lisa")).toBeInTheDocument();
    });
  });

  // ── Retry flow ──────────────────────────────────────────────────────

  it("retries status check from error state", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mocks.get.mockRejectedValueOnce(new Error("network error"));

    render(<AccountSettings />);
    await screen.findByText("Try again");

    // Now make the retry succeed
    mocks.get.mockResolvedValueOnce({ ghInstalled: true, authenticated: false });

    await user.click(screen.getByText("Try again"));

    await waitFor(() => {
      expect(screen.getByText("Not connected")).toBeInTheDocument();
    });
  });
});
