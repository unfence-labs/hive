import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useGitHubDeviceFlow } from "@/hooks/useGitHubDeviceFlow";

const mocks = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock("@/hooks/useApi", () => ({ api: { post: mocks.post } }));

const DEVICE_CODE = {
  userCode: "ABCD-1234",
  verificationUri: "https://github.com/login/device",
  expiresIn: 900,
  interval: 1,
};

const USER = {
  login: "octocat",
  name: "Mona Lisa",
  email: "octocat@github.com",
  avatarUrl: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

/** Let the poll timer fire and its promise settle. */
async function tick(seconds = 1): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(seconds * 1000);
  });
}

describe("useGitHubDeviceFlow", () => {
  it("surfaces the code and URL, then reports the connected account", async () => {
    mocks.post
      .mockResolvedValueOnce(DEVICE_CODE)
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({ status: "complete", user: USER });
    const { result } = renderHook(() => useGitHubDeviceFlow());

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.phase).toEqual({
      kind: "connecting",
      userCode: "ABCD-1234",
      verificationUri: "https://github.com/login/device",
    });

    await tick();
    await tick();

    await waitFor(() => expect(result.current.phase.kind).toBe("connected"));
    expect(result.current.phase).toMatchObject({ user: USER });
  });

  it("carries a git credential failure through rather than dropping it", async () => {
    mocks.post.mockResolvedValueOnce(DEVICE_CODE).mockResolvedValueOnce({
      status: "complete",
      user: USER,
      gitCredentialError: "configuring git credentials failed: permission denied",
    });
    const { result } = renderHook(() => useGitHubDeviceFlow());

    await act(async () => {
      await result.current.connect();
    });
    await tick();

    await waitFor(() =>
      expect(result.current.phase).toMatchObject({
        kind: "connected",
        gitCredentialError: expect.stringContaining("permission denied"),
      }),
    );
  });

  it("reports an expired code as expired", async () => {
    mocks.post.mockResolvedValueOnce(DEVICE_CODE).mockResolvedValueOnce({ status: "expired" });
    const { result } = renderHook(() => useGitHubDeviceFlow());

    await act(async () => {
      await result.current.connect();
    });
    await tick();

    await waitFor(() =>
      expect(result.current.phase).toEqual({
        kind: "error",
        message: "Authorization timed out. Please try again.",
      }),
    );
  });

  it("obeys the slower pace GitHub asks for", async () => {
    mocks.post
      .mockResolvedValueOnce(DEVICE_CODE)
      .mockResolvedValueOnce({ status: "slow_down", interval: 5 })
      .mockResolvedValueOnce({ status: "complete", user: USER });
    const { result } = renderHook(() => useGitHubDeviceFlow());

    await act(async () => {
      await result.current.connect();
    });
    await tick();

    // Still polling at the old pace would poll here; the hook must not.
    await tick();
    expect(result.current.phase.kind).toBe("connecting");

    await tick(4);
    await waitFor(() => expect(result.current.phase.kind).toBe("connected"));
  });

  it("tolerates a blip but gives up when the server is gone", async () => {
    mocks.post
      .mockResolvedValueOnce(DEVICE_CODE)
      .mockRejectedValueOnce(new Error("network down"))
      .mockRejectedValueOnce(new Error("network down"))
      .mockRejectedValueOnce(new Error("network down"));
    const { result } = renderHook(() => useGitHubDeviceFlow());

    await act(async () => {
      await result.current.connect();
    });

    await tick();
    expect(result.current.phase.kind).toBe("connecting");
    await tick();
    expect(result.current.phase.kind).toBe("connecting");
    await tick();

    await waitFor(() =>
      expect(result.current.phase).toMatchObject({
        kind: "error",
        message: expect.stringContaining("network down"),
      }),
    );
  });

  it("stops polling when the operator cancels", async () => {
    mocks.post.mockResolvedValueOnce(DEVICE_CODE).mockResolvedValue({ status: "pending" });
    const { result } = renderHook(() => useGitHubDeviceFlow());

    await act(async () => {
      await result.current.connect();
    });
    act(() => result.current.cancel());

    const callsAtCancel = mocks.post.mock.calls.length;
    await tick(10);

    expect(result.current.phase).toEqual({ kind: "idle" });
    expect(mocks.post).toHaveBeenCalledTimes(callsAtCancel);
  });

  it("stops polling when the component goes away", async () => {
    mocks.post.mockResolvedValueOnce(DEVICE_CODE).mockResolvedValue({ status: "pending" });
    const { result, unmount } = renderHook(() => useGitHubDeviceFlow());

    await act(async () => {
      await result.current.connect();
    });
    unmount();

    const callsAtUnmount = mocks.post.mock.calls.length;
    await tick(10);

    expect(mocks.post).toHaveBeenCalledTimes(callsAtUnmount);
  });

  it("reports a flow that could not be started", async () => {
    mocks.post.mockRejectedValueOnce(new Error("502"));
    const { result } = renderHook(() => useGitHubDeviceFlow());

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.phase).toEqual({
      kind: "error",
      message: "Failed to start GitHub connection flow",
    });
  });
});
