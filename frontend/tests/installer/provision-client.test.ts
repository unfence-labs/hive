import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTauriProvisionClient, type ProvisionRecord } from "@/lib/provision-client";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

/** Stands in for Tauri's Channel: the sidecar pushes records through onmessage. */
class ChannelMock<T> {
  onmessage: (message: T) => void = () => {};
}

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  Channel: ChannelMock,
}));

/**
 * The one place the installer's contract with the sidecar is a set of literal
 * strings. A renamed command or argument would break streaming silently, so it
 * is asserted rather than assumed.
 */
describe("the install bridge to the sidecar", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.invoke.mockResolvedValue(undefined);
  });

  const request = {
    connection: { host: "203.0.113.10", user: "ops", keyPath: "/home/lenny/.ssh/id_ed25519" },
    options: { port: 9420, installDir: "/opt/hive" },
  };

  it("streams every record the run emits onto the caller's callback", async () => {
    const received: ProvisionRecord[] = [];
    mocks.invoke.mockImplementation(
      (_command: string, args: { onEvent: ChannelMock<ProvisionRecord> }) => {
        args.onEvent.onmessage({ seq: 1, step: "probe_os", status: "log", line: "ubuntu 24.04" });
        args.onEvent.onmessage({ seq: 2, event: "run_end", status: "ok" });
        return Promise.resolve();
      },
    );

    await createTauriProvisionClient().install({ ...request, password: "hunter2" }, (record) =>
      received.push(record),
    );

    expect(received).toEqual([
      { seq: 1, step: "probe_os", status: "log", line: "ubuntu 24.04" },
      { seq: 2, event: "run_end", status: "ok" },
    ]);
    expect(mocks.invoke).toHaveBeenCalledWith(
      "provision_start",
      expect.objectContaining({
        connection: request.connection,
        options: request.options,
        password: "hunter2",
      }),
    );
  });

  it("says there is no password rather than leaving the argument out", async () => {
    await createTauriProvisionClient().install(request, () => {});

    expect(mocks.invoke).toHaveBeenCalledWith(
      "provision_start",
      expect.objectContaining({ password: null }),
    );
  });

  it("rejects with whatever the sidecar rejected with", async () => {
    mocks.invoke.mockRejectedValue({ code: "SSH_AUTH_FAILED", detail: "permission denied" });

    await expect(createTauriProvisionClient().install(request, () => {})).rejects.toEqual({
      code: "SSH_AUTH_FAILED",
      detail: "permission denied",
    });
  });
});
