import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Installer from "@/pages/installer/Installer";
import {
  INSTALLER_SCHEMA,
  INSTALLER_STORAGE_KEY,
  defaultInputs,
  loadMachine,
  type InstallerInputs,
  type InstallerState,
} from "@/pages/installer/machine";
import { clearInstallRuns } from "@/pages/installer/install-run";
import { CONNECTION_STORAGE_KEY, getConnection, replaceConnection } from "@/hooks/useConnection";
import {
  ACCESS_TOKEN,
  UNTRUSTED_HOST,
  blockedReport,
  createMockProvisionClient,
  failureRecords,
  report,
  successRecords,
} from "./mock-provision-client";

/** Resume the installer directly on a screen, the way a relaunch would. */
function seed(state: InstallerState, inputs: Partial<InstallerInputs> = {}) {
  localStorage.setItem(
    INSTALLER_STORAGE_KEY,
    JSON.stringify({
      schema: INSTALLER_SCHEMA,
      state,
      inputs: {
        ...defaultInputs(),
        address: "root@203.0.113.10",
        sshKeyPath: "/home/lenny/.ssh/id_ed25519",
        ...inputs,
      },
    }),
  );
}

/** Everything a running install needs, without walking the earlier screens. */
function seedRunningInstall(inputs: Partial<InstallerInputs> = {}) {
  seed("install", { privilegeMode: "root", ...inputs });
}

/** What the whole of browser storage holds right now, as one string. */
function storageContents(): string {
  return Array.from({ length: localStorage.length }, (_, index) =>
    localStorage.getItem(localStorage.key(index) as string),
  ).join("\n");
}

describe("Installer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    // The run registry outlives a component, which is the point of it — but it
    // must not outlive a test.
    clearInstallRuns();
  });

  it("offers installing or connecting to an existing server, and nothing else", () => {
    render(<Installer client={createMockProvisionClient()} />);

    expect(screen.getByRole("button", { name: "Install on a server" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I already have a server" })).toBeInTheDocument();
    // The second path is the skip; there is no separate skip control, and with
    // no server configured there is no way to abandon the installer either.
    expect(screen.queryByRole("button", { name: /skip/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "prerequisites" })).toBeInTheDocument();
  });

  it("configures the app from the existing-server form and dismisses itself", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("[]", { status: 200 }));
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Installer client={createMockProvisionClient()} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "I already have a server" }));
    await user.type(screen.getByLabelText("Address"), "100.64.0.10");
    await user.type(screen.getByLabelText("Access token"), "issued-token");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    // The port field defaults to the production port, not the development one.
    expect(fetchMock).toHaveBeenCalledWith(
      "http://100.64.0.10:9420/api/projects",
      expect.objectContaining({ headers: { Authorization: "Bearer issued-token" } }),
    );
    expect(getConnection()).toMatchObject({
      host: "100.64.0.10",
      port: 9420,
      authToken: "issued-token",
    });
    // Nothing was installed, so no installer progress survives.
    expect(localStorage.getItem(INSTALLER_STORAGE_KEY)).toBe(
      JSON.stringify({ schema: INSTALLER_SCHEMA, state: "welcome", inputs: defaultInputs() }),
    );
  });

  it("stores nothing when the existing server does not answer", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Installer client={createMockProvisionClient()} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "I already have a server" }));
    await user.type(screen.getByLabelText("Address"), "100.64.0.10");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("could not be reached");
    expect(getConnection()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("offers Cancel only when a server is already configured", () => {
    render(<Installer client={createMockProvisionClient()} onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("collects the exposure mode, address, port and the advanced directories", async () => {
    const user = userEvent.setup();
    const client = createMockProvisionClient();
    render(<Installer client={client} />);

    await user.click(screen.getByRole("button", { name: "Install on a server" }));

    // The port is pre-filled with the production port.
    expect(screen.getByLabelText("Port")).toHaveValue("9420");
    expect(screen.queryByLabelText("Install directory")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Advanced" }));
    expect(screen.getByLabelText("Install directory")).toHaveValue("/opt/hive");
    expect(screen.getByLabelText("Data directory")).toHaveValue("/home/hive/.hive");
    // The interface only exists for the mode that needs it.
    expect(screen.queryByLabelText("Private network interface")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("radio", { name: "Reachable only over a private network" }),
    );
    expect(screen.getByLabelText("Private network interface")).toHaveValue("tailscale0");

    const address = screen.getByLabelText("Address");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    await user.type(address, "root@203.0.113.10");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("id_ed25519")).toBeInTheDocument();
  });

  it("marks unusable keys as such and offers a re-scan", async () => {
    const user = userEvent.setup();
    const client = createMockProvisionClient();
    seed("ssh_key");
    render(<Installer client={client} />);

    expect(await screen.findByRole("radio", { name: "id_ed25519" })).toBeEnabled();
    expect(screen.getByRole("radio", { name: "id_rsa" })).toBeDisabled();
    expect(screen.getByText(/it has a passphrase and no agent holds it/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Scan again" }));
    await waitFor(() => expect(client.listKeys).toHaveBeenCalledTimes(2));
  });

  it("asks for the server's fingerprint before it runs preflight over it", async () => {
    const user = userEvent.setup();
    const client = createMockProvisionClient();
    seed("connect");
    render(<Installer client={client} />);

    expect(await screen.findByText(UNTRUSTED_HOST.fingerprint, { exact: false })).toBeInTheDocument();
    expect(client.preflight).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Approve and check the server" }));

    await waitFor(() =>
      expect(client.trustHost).toHaveBeenCalledWith("203.0.113.10", UNTRUSTED_HOST.hostKey),
    );
    await waitFor(() => expect(client.preflight).toHaveBeenCalledTimes(1));
    expect(client.preflight).toHaveBeenCalledWith(
      { host: "203.0.113.10", user: "root", keyPath: "/home/lenny/.ssh/id_ed25519" },
      expect.objectContaining({ port: 9420, installDir: "/opt/hive", networkMode: "public" }),
    );
  });

  it("never shows a password field when the account reaches root on its own", async () => {
    const client = createMockProvisionClient({
      identity: { ...UNTRUSTED_HOST, trusted: true },
      preflight: report({ privilege: { root: true, sudoNoPassword: true, mode: "root" } }),
    });
    seed("connect");
    render(<Installer client={client} />);

    expect(await screen.findByText("port 9420 is free")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Password for/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("asks for a password only when preflight says escalation needs one", async () => {
    const user = userEvent.setup();
    const client = createMockProvisionClient({
      identity: { ...UNTRUSTED_HOST, trusted: true },
      preflight: report({
        privilege: { root: false, sudoNoPassword: false, mode: "sudoPassword" },
      }),
    });
    seed("connect", { address: "ops@203.0.113.10" });
    render(<Installer client={client} />);

    const password = await screen.findByLabelText("Password for ops");
    // The install cannot start without it.
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();

    await user.type(password, "hunter2");
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Ready to install");
    // The password reaches the install step, and never the persisted record.
    expect(screen.getByText("sudo, with the password you entered")).toBeInTheDocument();
    expect(localStorage.getItem(INSTALLER_STORAGE_KEY)).not.toContain("hunter2");
  });

  it("stops on a blocking finding and names the field that corrects it", async () => {
    const user = userEvent.setup();
    const client = createMockProvisionClient({
      identity: { ...UNTRUSTED_HOST, trusted: true },
      preflight: blockedReport(),
    });
    seed("connect");
    render(<Installer client={client} />);

    expect(
      await screen.findByText("port 9420 is already in use by another service"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Go back and correct the port on the Network step, then test again."),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The install cannot start until the findings above are cleared.",
    );
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();

    // Back navigation is free: the server has not been touched.
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("radio", { name: "id_ed25519" })).toBeInTheDocument();
  });

  it("reports a non-blocking finding without standing in the way", async () => {
    const client = createMockProvisionClient({
      identity: { ...UNTRUSTED_HOST, trusted: true },
      preflight: report({
        checks: [
          {
            check: "firewall",
            status: "warn",
            detail: "nftables is active and is not modified by this installer",
          },
        ],
      }),
    });
    seed("connect");
    render(<Installer client={client} />);

    expect(
      await screen.findByText("nftables is active and is not modified by this installer"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("surfaces an unreachable server with its hint and a retry", async () => {
    const user = userEvent.setup();
    const client = createMockProvisionClient();
    client.testConnection.mockRejectedValue({
      code: "SSH_UNREACHABLE",
      detail: "ssh: connect to host 203.0.113.10 port 22: No route to host",
    });
    seed("connect");
    render(<Installer client={client} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("SSH_UNREACHABLE");
    expect(alert).toHaveTextContent("The server did not answer on SSH.");
    expect(alert).toHaveTextContent("No route to host");

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(client.testConnection).toHaveBeenCalledTimes(2));
  });

  it("resumes on the screen it stopped on", async () => {
    seed("network", { address: "root@198.51.100.7", port: 8080 });
    render(<Installer client={createMockProvisionClient()} />);

    expect(await screen.findByLabelText("Address")).toHaveValue("root@198.51.100.7");
    expect(screen.getByLabelText("Port")).toHaveValue("8080");
  });

  // ── the install ────────────────────────────────────────────────────────────

  it("restates the plan before it touches anything, and starts only when told to", async () => {
    const user = userEvent.setup();
    const client = createMockProvisionClient();
    seed("review", { privilegeMode: "root" });
    render(<Installer client={client} />);

    expect(await screen.findByText("Ready to install")).toBeInTheDocument();
    expect(client.install).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Start the install" }));

    await waitFor(() => expect(client.installs).toHaveLength(1));
    expect(client.installs[0].request.connection).toEqual({
      host: "203.0.113.10",
      user: "root",
      keyPath: "/home/lenny/.ssh/id_ed25519",
    });
    expect(client.installs[0].request.options).toMatchObject({
      port: 9420,
      installDir: "/opt/hive",
      dataDir: "/home/hive/.hive",
      networkMode: "public",
    });
  });

  it("offers no way out while the install is running", async () => {
    const client = createMockProvisionClient();
    seedRunningInstall();
    // onClose is what a re-launched installer gets; even then, nothing here
    // may offer to leave a run that the server carries on regardless.
    render(<Installer client={client} onClose={vi.fn()} />);

    await waitFor(() => expect(client.installs).toHaveLength(1));
    act(() => client.installs[0].emit(...successRecords().slice(0, 4)));

    const steps = await screen.findByRole("list", { name: "Install steps" });
    expect(within(steps).getByText("Check the server")).toBeInTheDocument();

    for (const label of [/back/i, /cancel/i, /skip/i, /later/i, /start over/i, /retry/i]) {
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    }
  });

  it("shows the streamed output, folds it away, and never writes it to storage", async () => {
    const user = userEvent.setup();
    const client = createMockProvisionClient();
    seedRunningInstall();
    render(<Installer client={client} />);

    await waitFor(() => expect(client.installs).toHaveLength(1));
    act(() => client.installs[0].emit(...successRecords().slice(0, 4)));

    const log = await screen.findByLabelText("Install output");
    expect(log).toHaveTextContent("ubuntu 24.04 x86_64");
    expect(storageContents()).not.toContain("ubuntu 24.04 x86_64");

    await user.click(screen.getByRole("button", { name: "Output" }));
    expect(screen.queryByLabelText("Install output")).not.toBeInTheDocument();
  });

  it("attaches to the run in progress rather than starting a second one", async () => {
    const client = createMockProvisionClient();
    seedRunningInstall();
    const first = render(<Installer client={client} />);

    await waitFor(() => expect(client.install).toHaveBeenCalledTimes(1));
    act(() => client.installs[0].emit(...successRecords().slice(0, 4)));
    first.unmount();

    // Re-entering the install — a remount, a route change, a re-render — must
    // not spawn a second ssh process against the same server.
    render(<Installer client={client} />);
    const steps = await screen.findByRole("list", { name: "Install steps" });

    expect(client.install).toHaveBeenCalledTimes(1);
    // It attached to what was already running: the earlier progress is there.
    expect(within(steps).getByText("Check the server")).toBeInTheDocument();
  });

  it("returns to the running install after a relaunch and continues it", async () => {
    const client = createMockProvisionClient();
    seedRunningInstall();
    const first = render(<Installer client={client} />);

    await waitFor(() => expect(client.installs).toHaveLength(1));
    act(() => client.installs[0].emit(...successRecords().slice(0, 4)));

    // Quitting the app takes the ssh process and the in-memory run with it.
    first.unmount();
    clearInstallRuns();

    // Relaunching lands back on the install, not at the beginning.
    expect(loadMachine().state).toBe("install");
    render(<Installer client={client} />);

    await waitFor(() => expect(client.installs).toHaveLength(2));
    act(() => client.installs[1].emit(...successRecords(true).slice(0, 6)));

    expect(screen.getByText(/Continuing an earlier run/)).toBeInTheDocument();
    const steps = screen.getByRole("list", { name: "Install steps" });
    expect(within(steps).getByText("Create user").closest("li")).toHaveTextContent("already done");
  });

  it("asks for the escalation password again when the run cannot resume without it", () => {
    seed("install", { privilegeMode: "sudoPassword", address: "ops@203.0.113.10" });

    // The password is deliberately never persisted, so an install that needs
    // one resumes onto connect — read-only — instead of failing on the wire.
    expect(loadMachine().state).toBe("connect");
  });

  it("offers retry and back on failure, and retry resumes rather than restarts", async () => {
    const user = userEvent.setup();
    const client = createMockProvisionClient();
    seedRunningInstall();
    render(<Installer client={client} />);

    await waitFor(() => expect(client.installs).toHaveLength(1));
    act(() => client.installs[0].emit(...failureRecords()));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("DIRECTORY_UNUSABLE");
    expect(alert).toHaveTextContent("Hive cannot write to the install or data directory");
    expect(alert).toHaveTextContent("/home/hive/.hive is not writable");
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(client.installs).toHaveLength(2));
    // The retried run reports itself as a resume; nothing is repeated.
    act(() => client.installs[1].emit(...successRecords(true).slice(0, 6)));
    expect(screen.getByText(/Continuing an earlier run/)).toBeInTheDocument();
    // And it is a run in progress again, so the way out closes.
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("lets a failed run go back to the plan so a bad value can be corrected", async () => {
    const user = userEvent.setup();
    const client = createMockProvisionClient();
    seedRunningInstall();
    render(<Installer client={client} />);

    await waitFor(() => expect(client.installs).toHaveLength(1));
    act(() => client.installs[0].emit(...failureRecords()));
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(await screen.findByText("Ready to install")).toBeInTheDocument();
  });

  it("surfaces a sidecar that rejected without ever reaching the script", async () => {
    const client = createMockProvisionClient();
    seedRunningInstall();
    render(<Installer client={client} />);

    await waitFor(() => expect(client.installs).toHaveLength(1));
    act(() => client.installs[0].fail({ code: "SSH_AUTH_FAILED", detail: "permission denied" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("SSH_AUTH_FAILED");
    expect(alert).toHaveTextContent("permission denied");
  });

  it("lands on the installed server with the service account and the admin login apart", async () => {
    const client = createMockProvisionClient();
    const onClose = vi.fn();
    seedRunningInstall({ address: "ops@203.0.113.10" });
    render(<Installer client={client} onClose={onClose} />);

    await waitFor(() => expect(client.installs).toHaveLength(1));
    act(() => client.installs[0].emit(...successRecords()));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(getConnection()).toEqual({
      host: "203.0.113.10",
      port: 9420,
      authToken: ACCESS_TOKEN,
      // Day-to-day editor and terminal sessions run as the service account…
      sshUser: "hive",
      // …and the install login is kept only for a future reinstall.
      adminUser: "ops",
    });
    // The installer is done with this server, so nothing of it survives.
    expect(localStorage.getItem(INSTALLER_STORAGE_KEY)).toBeNull();
  });

  it("keeps the service account of a resumed run that never reported one", async () => {
    const client = createMockProvisionClient();
    const onClose = vi.fn();
    seedRunningInstall();
    render(<Installer client={client} onClose={onClose} />);

    await waitFor(() => expect(client.installs).toHaveLength(1));
    act(() => client.installs[0].emit(...successRecords(true)));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(getConnection()).toMatchObject({ sshUser: "hive", adminUser: "root" });
  });

  it("leaves an existing connection untouched when a re-launched installer is abandoned", async () => {
    replaceConnection({ host: "100.64.0.10", port: 9420, authToken: "old", sshUser: "hive" });
    const before = localStorage.getItem(CONNECTION_STORAGE_KEY);
    const onClose = vi.fn();
    const user = userEvent.setup();
    const client = createMockProvisionClient();
    render(<Installer client={client} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(CONNECTION_STORAGE_KEY)).toBe(before);
  });
});
