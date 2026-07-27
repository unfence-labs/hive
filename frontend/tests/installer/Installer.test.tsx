import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Installer from "@/pages/installer/Installer";
import {
  INSTALLER_SCHEMA,
  INSTALLER_STORAGE_KEY,
  defaultInputs,
  type InstallerInputs,
  type InstallerState,
} from "@/pages/installer/machine";
import { getConnection } from "@/hooks/useConnection";
import {
  UNTRUSTED_HOST,
  blockedReport,
  createMockProvisionClient,
  report,
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

describe("Installer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
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
});
