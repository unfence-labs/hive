import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import type { ToolStatus, ToolsResponse } from "@hive/shared/setup-types";
import type { AccountStatus } from "@/lib/setup-api";
import Installer from "@/pages/installer/Installer";
import {
  INSTALLER_SCHEMA,
  INSTALLER_STORAGE_KEY,
  defaultInputs,
  loadMachine,
  type InstallerInputs,
  type InstallerState,
} from "@/pages/installer/machine";
import { INSTALL_FLUSH_MS, clearInstallRuns } from "@/pages/installer/install-run";
import { CONNECTION_STORAGE_KEY, getConnection, replaceConnection } from "@/hooks/useConnection";
import type { ProvisionRecord } from "@/lib/provision-client";
import {
  ACCESS_TOKEN,
  UNTRUSTED_HOST,
  USABLE_KEY,
  activeFirewallReport,
  blockedReport,
  createMockProvisionClient,
  failureRecords,
  foreignFirewallReport,
  report,
  successRecords,
  type MockInstall,
} from "./mock-provision-client";
import { createWrapper } from "../test-utils";

const mocks = vi.hoisted(() => ({ copyToClipboard: vi.fn() }));

vi.mock("@/lib/clipboard", () => ({ copyToClipboard: mocks.copyToClipboard }));

/** The final screen renders the tools panel, and the panel is a query. */
function renderInstaller(ui: ReactElement) {
  const { wrapper } = createWrapper();
  return render(ui, { wrapper });
}

/** A GitHub account already signed in on the server. */
const GITHUB_CONNECTED: AccountStatus = {
  ghInstalled: true,
  authenticated: true,
  user: { login: "lenny", name: "Lenny", email: "lenny@example.com", avatarUrl: "" },
};

/**
 * Any form of the accounts gate hint. The hint always ends with one of the
 * requirement items followed by a period, which no other copy on the screen
 * does — the buttons and descriptions never carry that trailing period.
 */
const GATE_HINT = /(copy the access token|sign in to Claude or Codex)\./i;

/** The tools a freshly installed server reports, all present and up to date. */
function toolList(claudeSignedIn = false): ToolStatus[] {
  return [
    { id: "claude", label: "Claude Code", installed: true, version: "1.0.0", latestVersion: "1.0.0", updateAvailable: false, authenticated: claudeSignedIn, managed: true },
    { id: "codex", label: "Codex", installed: true, version: "0.5.0", latestVersion: "0.5.0", updateAvailable: false, authenticated: false, managed: true },
    { id: "gh", label: "GitHub CLI", installed: true, version: "2.0.0", latestVersion: "2.0.0", updateAvailable: false, authenticated: false, managed: true },
  ];
}

/**
 * Answer the final screen's reads. By default nothing is signed in, which is
 * exactly the state a freshly installed server is in.
 */
function stubTools(overrides: Partial<ToolsResponse> = {}, account: Partial<AccountStatus> = {}) {
  const body: ToolsResponse = {
    tools: toolList(),
    operations: [],
    authSessions: [],
    ...overrides,
  };
  // The status poll reads operations and auth sessions off its own endpoint,
  // so it gets an idle body rather than an empty object it would trip over.
  const idle = JSON.stringify({ operations: body.operations, authSessions: body.authSessions });
  // The GitHub card reads the account endpoint, which is a different server
  // fact from the gh tool the panel filters out.
  const status = JSON.stringify({ ghInstalled: true, authenticated: false, ...account });
  return vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    const answer = url.includes("/api/setup/tools")
      ? JSON.stringify(body)
      : url.includes("/api/account/status")
        ? status
        : idle;
    return Promise.resolve(
      new Response(answer, { status: 200, headers: { "Content-Type": "application/json" } }),
    );
  });
}

/**
 * Push records into a run and advance past the batching window, so the folded
 * progress is on screen by the time the next assertion runs.
 */
function emit(install: MockInstall, ...records: ProvisionRecord[]) {
  act(() => {
    install.emit(...records);
    vi.advanceTimersByTime(INSTALL_FLUSH_MS);
  });
}

/**
 * Run an install to completion, landing on the final screen. A finished run
 * waits on the operator, so the walk includes the click that leaves it.
 */
async function installTo(
  client: ReturnType<typeof createMockProvisionClient>,
  onClose: () => void,
  records = successRecords(),
) {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  renderInstaller(<Installer client={client} onClose={onClose} />);
  await waitFor(() => expect(client.installs).toHaveLength(1));
  emit(client.installs[0], ...records);
  await user.click(await screen.findByRole("button", { name: "Continue" }));
  return screen.findByRole("heading", { name: "Connect your accounts" });
}

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

/**
 * Walk from the welcome choice onto the server screen and start the check.
 * The server step never resumes, so every test reaches it the way an operator
 * does.
 */
async function connectToServer(
  user: ReturnType<typeof userEvent.setup>,
  address = "root@203.0.113.10",
) {
  await user.click(screen.getByRole("button", { name: "Install on a server" }));
  // The local key scan auto-selects the first usable key.
  await screen.findByText("id_ed25519");
  await user.type(screen.getByLabelText("Address"), address);
  await user.click(screen.getByRole("button", { name: "Connect" }));
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
    mocks.copyToClipboard.mockReset().mockResolvedValue(undefined);
    // The install path only exists inside the desktop shell; these tests
    // exercise it, so they run as the shell. The web variant has its own test.
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    // Streamed install records reach the screen once per flush window, so the
    // tests drive that clock rather than waiting it out.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.clear();
    // The run registry outlives a component, which is the point of it — but it
    // must not outlive a test.
    clearInstallRuns();
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    vi.useRealTimers();
  });

  it("offers installing or connecting to an existing server, and nothing else", () => {
    render(<Installer client={createMockProvisionClient()} />);

    expect(screen.getByRole("button", { name: "Install on a server" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I already have a server" })).toBeInTheDocument();
    // The second path is the skip; there is no separate skip control, and with
    // no server configured there is no way to abandon the installer either.
    expect(screen.queryByRole("button", { name: /skip/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    // The welcome screen sells; the prerequisites live on the install steps.
    expect(screen.queryByRole("button", { name: "prerequisites" })).not.toBeInTheDocument();
  });

  it("offers only the existing-server path in the web build", () => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    render(<Installer client={createMockProvisionClient()} />);

    // No SSH sidecar, no install path — connecting is the whole offer, so the
    // form shows without a choice to make first.
    expect(screen.queryByRole("button", { name: "Install on a server" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Address")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("configures the app from the existing-server form and dismisses itself", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("[]", { status: 200 }));
    const onClose = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
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
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Installer client={createMockProvisionClient()} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "I already have a server" }));
    await user.type(screen.getByLabelText("Address"), "100.64.0.10");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("could not be reached");
    expect(getConnection()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("offers Cancel only when a server is already configured", () => {
    render(<Installer client={createMockProvisionClient()} onClose={vi.fn()} cancellable />);

    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("collects the address and key up front, keeps the rest under Advanced, and asks nothing about the network", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createMockProvisionClient();
    render(<Installer client={client} />);

    await user.click(screen.getByRole("button", { name: "Install on a server" }));

    // The install connects over SSH, so up front there are only the address
    // and the key; Hive's own serving port is an Advanced detail.
    expect(screen.queryByLabelText("Hive port")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Install directory")).not.toBeInTheDocument();
    // The technical reading moved off the welcome screen to here.
    expect(screen.getByRole("button", { name: /networking guide/i })).toBeInTheDocument();

    // How the server is reachable is the operator's business, so there is no
    // exposure question here at all — and nothing to answer it with.
    expect(screen.queryAllByRole("radio")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Advanced" }));
    // The port is pre-filled with the production port.
    expect(screen.getByLabelText("Hive port")).toHaveValue("9420");
    expect(screen.getByLabelText("Install directory")).toHaveValue("/opt/hive");
    expect(screen.getByLabelText("Data directory")).toHaveValue("/home/hive/.hive");
    expect(screen.queryAllByRole("radio")).toHaveLength(0);

    // The scan auto-selects the first usable key; the address is what unlocks
    // the connection attempt.
    expect(await screen.findByText("id_ed25519")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
    await user.type(screen.getByLabelText("Address"), "root@203.0.113.10");
    expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled();
    // Nothing has been contacted yet: connecting is an explicit act.
    expect(client.testConnection).not.toHaveBeenCalled();
  });

  it("marks unusable keys as such and offers a re-scan", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createMockProvisionClient();
    render(<Installer client={client} />);
    await user.click(screen.getByRole("button", { name: "Install on a server" }));

    expect(await screen.findByText("id_ed25519")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "SSH key" }));

    expect(screen.getByRole("button", { name: /id_rsa/ })).toBeDisabled();
    expect(screen.getByText(/it has a passphrase and no agent holds it/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Scan again" }));
    await waitFor(() => expect(client.listKeys).toHaveBeenCalledTimes(2));
  });

  it("asks for the server's fingerprint before it runs preflight over it", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createMockProvisionClient();
    render(<Installer client={client} />);
    await connectToServer(user);

    expect(await screen.findByText(UNTRUSTED_HOST.fingerprint, { exact: false })).toBeInTheDocument();
    expect(client.preflight).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Approve fingerprint" }));

    await waitFor(() =>
      expect(client.trustHost).toHaveBeenCalledWith("203.0.113.10", UNTRUSTED_HOST.hostKey),
    );
    await waitFor(() => expect(client.preflight).toHaveBeenCalledTimes(1));
    expect(client.preflight).toHaveBeenCalledWith(
      { host: "203.0.113.10", user: "root", keyPath: "/home/lenny/.ssh/id_ed25519" },
      {
        port: 9420,
        installDir: "/opt/hive",
        dataDir: "/home/hive/.hive",
        sshPublicKey: USABLE_KEY.publicKey,
      },
    );
  });

  it("never shows a password field when the account reaches root on its own", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createMockProvisionClient({
      identity: { ...UNTRUSTED_HOST, trusted: true },
      preflight: report({ privilege: { mode: "root" } }),
    });
    render(<Installer client={client} />);
    await connectToServer(user);

    // A clean bill folds to one line; the details are a click away.
    expect(await screen.findByRole("button", { name: "All 3 checks passed" })).toBeInTheDocument();
    expect(screen.queryByText("port 9420 is free")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "All 3 checks passed" }));
    expect(screen.getByText("port 9420 is free")).toBeInTheDocument();

    expect(screen.queryByLabelText(/^Password for/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("asks for a password only when preflight says escalation needs one", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createMockProvisionClient({
      identity: { ...UNTRUSTED_HOST, trusted: true },
      preflight: report({
        privilege: { mode: "sudoPassword" },
      }),
    });
    render(<Installer client={client} />);
    await connectToServer(user, "ops@203.0.113.10");

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

  it("stops on a blocking finding, names the field that corrects it, and editing it resets the check", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createMockProvisionClient({
      identity: { ...UNTRUSTED_HOST, trusted: true },
      preflight: blockedReport(),
    });
    render(<Installer client={client} />);
    await connectToServer(user);

    // A failure arrives unfolded: the detail and its correction read directly.
    expect(
      await screen.findByText("port 9420 is already in use by another service"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 of 3 checks failed" })).toBeInTheDocument();
    expect(
      screen.getByText("Correct the Hive port under Advanced, then connect again."),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The install cannot start until the findings above are cleared.",
    );
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();

    // The named field is on this same screen. Correcting it discards the
    // stale report and re-arms the connection check — no back navigation.
    await user.click(screen.getByRole("button", { name: "Advanced" }));
    await user.clear(screen.getByLabelText("Hive port"));
    await user.type(screen.getByLabelText("Hive port"), "9421");
    expect(
      screen.queryByText("port 9420 is already in use by another service"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled();
  });

  it("blocks when an active firewall cannot be configured automatically", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createMockProvisionClient({
      identity: { ...UNTRUSTED_HOST, trusted: true },
      preflight: foreignFirewallReport(),
    });
    render(<Installer client={client} />);
    await connectToServer(user);

    expect(
      await screen.findByText("nftables is active, and Hive cannot configure it automatically"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("never asks about the firewall when no firewall is active", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createMockProvisionClient({
      identity: { ...UNTRUSTED_HOST, trusted: true },
    });
    render(<Installer client={client} />);
    await connectToServer(user);

    // The report says plainly what will happen and on which port, and there is
    // nothing to decide: no rule is written, so no question is put.
    await user.click(await screen.findByRole("button", { name: "All 3 checks passed" }));
    expect(
      screen.getByText("no active firewall; the installer will not enable one"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/This server runs an active firewall/)).not.toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  it("opens the Hive port automatically when ufw is active", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createMockProvisionClient({
      identity: { ...UNTRUSTED_HOST, trusted: true },
      preflight: activeFirewallReport(),
    });
    render(<Installer client={client} />);
    await connectToServer(user);

    await user.click(await screen.findByRole("button", { name: "All 3 checks passed" }));
    expect(
      screen.getByText(
        "ufw is active; the installer will open TCP port 9420 automatically and change nothing else",
      ),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Continue" }));

    // The review manifest restates the firewall promise with the real port.
    expect(await screen.findByText("ufw allow 9420/tcp")).toBeInTheDocument();
    expect(screen.getByText(/never enables or reconfigures a firewall/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start the install" }));

    await waitFor(() => expect(client.installs).toHaveLength(1));
    expect(client.installs[0].request.options.port).toBe(9420);
  });

  it("surfaces an unreachable server with its hint, and Connect re-arms as the retry", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createMockProvisionClient();
    client.testConnection.mockRejectedValue({
      code: "SSH_UNREACHABLE",
      detail: "ssh: connect to host 203.0.113.10 port 22: No route to host",
    });
    render(<Installer client={client} />);
    await connectToServer(user);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("SSH_UNREACHABLE");
    expect(alert).toHaveTextContent("The server did not answer on SSH.");
    expect(alert).toHaveTextContent("No route to host");

    await user.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(client.testConnection).toHaveBeenCalledTimes(2));
  });

  it("starts over instead of resuming a run that never touched the server", async () => {
    seed("server", { address: "root@198.51.100.7", port: 8080 });
    render(<Installer client={createMockProvisionClient()} />);

    // Nothing durable exists before the server step completes, so nothing
    // resumes — not the screen, and not the half-typed draft either.
    expect(
      await screen.findByRole("button", { name: "Install on a server" }),
    ).toBeInTheDocument();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: "Install on a server" }));
    expect(screen.getByLabelText("Address")).toHaveValue("");
  });

  // ── the install ────────────────────────────────────────────────────────────

  it("restates the plan before it touches anything, and starts only when told to", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
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
    expect(client.installs[0].request.options).toEqual({
      port: 9420,
      installDir: "/opt/hive",
      dataDir: "/home/hive/.hive",
    });
  });

  it("offers no way out while the install is running", async () => {
    const client = createMockProvisionClient();
    seedRunningInstall();
    // onClose is what a re-launched installer gets; even then, nothing here
    // may offer to leave a run that the server carries on regardless.
    render(<Installer client={client} onClose={vi.fn()} />);

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await waitFor(() => expect(client.installs).toHaveLength(1));
    emit(client.installs[0], ...successRecords().slice(0, 4));

    // A healthy run reads as one line and a bar; the checklist is folded away
    // until it is asked for.
    expect(await screen.findByRole("progressbar", { name: "Install progress" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Install steps" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "All steps" }));
    const steps = screen.getByRole("list", { name: "Install steps" });
    expect(within(steps).getByText("Check the server")).toBeInTheDocument();

    for (const label of [/back/i, /cancel/i, /skip/i, /later/i, /start over/i, /retry/i]) {
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    }
  });

  it("waits on the operator when the run finishes rather than moving on by itself", async () => {
    stubTools();
    const client = createMockProvisionClient();
    seedRunningInstall();
    renderInstaller(<Installer client={client} />);

    await waitFor(() => expect(client.installs).toHaveLength(1));
    emit(client.installs[0], ...successRecords());

    // The output of a finished run is the one thing worth reading, so nothing
    // advances until Continue is pressed — and nothing is stored before it.
    expect(await screen.findByText("Hive is installed")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Connect your accounts" })).not.toBeInTheDocument();
    expect(getConnection()).toBeNull();

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("heading", { name: "Connect your accounts" })).toBeInTheDocument();
    expect(getConnection()).toMatchObject({ authToken: ACCESS_TOKEN, sshUser: "hive" });
  });

  it("shows the streamed output as the screen, and never writes it to storage", async () => {
    const client = createMockProvisionClient();
    seedRunningInstall();
    render(<Installer client={client} />);

    await waitFor(() => expect(client.installs).toHaveLength(1));
    emit(client.installs[0], ...successRecords().slice(0, 4));

    // The output is always on: it is what the screen is for while a run goes.
    const log = await screen.findByLabelText("Install output");
    expect(log).toHaveTextContent("ubuntu 24.04 x86_64");
    expect(storageContents()).not.toContain("ubuntu 24.04 x86_64");
  });

  it("attaches to the run in progress rather than starting a second one", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createMockProvisionClient();
    seedRunningInstall();
    const first = render(<Installer client={client} />);

    await waitFor(() => expect(client.install).toHaveBeenCalledTimes(1));
    emit(client.installs[0], ...successRecords().slice(0, 4));
    first.unmount();

    // Re-entering the install — a remount, a route change, a re-render — must
    // not spawn a second ssh process against the same server.
    render(<Installer client={client} />);
    await user.click(await screen.findByRole("button", { name: "All steps" }));
    const steps = screen.getByRole("list", { name: "Install steps" });

    expect(client.install).toHaveBeenCalledTimes(1);
    // It attached to what was already running: the earlier progress is there.
    expect(within(steps).getByText("Check the server")).toBeInTheDocument();
  });

  it("returns to the running install after a relaunch and continues it", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createMockProvisionClient();
    seedRunningInstall();
    const first = render(<Installer client={client} />);

    await waitFor(() => expect(client.installs).toHaveLength(1));
    emit(client.installs[0], ...successRecords().slice(0, 4));

    // Quitting the app takes the ssh process and the in-memory run with it.
    first.unmount();
    clearInstallRuns();

    // Relaunching lands back on the install, not at the beginning.
    expect(loadMachine().state).toBe("install");
    render(<Installer client={client} />);

    await waitFor(() => expect(client.installs).toHaveLength(2));
    emit(client.installs[1], ...successRecords(true).slice(0, 6));

    expect(screen.getByText(/Continuing an earlier run/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "All steps" }));
    const steps = screen.getByRole("list", { name: "Install steps" });
    expect(within(steps).getByText("Create user").closest("li")).toHaveTextContent("already done");
  });

  it("asks for the escalation password again when the run cannot resume without it", () => {
    seed("install", { privilegeMode: "sudoPassword", address: "ops@203.0.113.10" });

    // The password is deliberately never persisted, so an install that needs
    // one resumes onto the server step — with its inputs kept, one click away
    // from re-checking — instead of failing on the wire.
    const resumed = loadMachine();
    expect(resumed.state).toBe("server");
    expect(resumed.inputs.address).toBe("ops@203.0.113.10");
  });

  it("offers retry and back on failure, and retry resumes rather than restarts", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createMockProvisionClient();
    seedRunningInstall();
    render(<Installer client={client} />);

    await waitFor(() => expect(client.installs).toHaveLength(1));
    emit(client.installs[0], ...failureRecords());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("DIRECTORY_UNUSABLE");
    expect(alert).toHaveTextContent("Hive cannot write to the install or data directory");
    expect(alert).toHaveTextContent("/home/hive/.hive is not writable");
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();

    // A failure unfolds the checklist on its own: which step stopped, and what
    // ran before it, is exactly what has to be read now.
    const steps = screen.getByRole("list", { name: "Install steps" });
    expect(within(steps).getByText("Check the server")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(client.installs).toHaveLength(2));
    // The retried run reports itself as a resume; nothing is repeated.
    emit(client.installs[1], ...successRecords(true).slice(0, 6));
    expect(screen.getByText(/Continuing an earlier run/)).toBeInTheDocument();
    // And it is a run in progress again, so the way out closes.
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("lets a failed run go back to the plan so a bad value can be corrected", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createMockProvisionClient();
    seedRunningInstall();
    render(<Installer client={client} />);

    await waitFor(() => expect(client.installs).toHaveLength(1));
    emit(client.installs[0], ...failureRecords());
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
    stubTools();
    const client = createMockProvisionClient();
    const onClose = vi.fn();
    seedRunningInstall({ address: "ops@203.0.113.10" });

    await installTo(client, onClose);

    expect(getConnection()).toEqual({
      host: "203.0.113.10",
      port: 9420,
      authToken: ACCESS_TOKEN,
      // Day-to-day editor and terminal sessions run as the service account…
      sshUser: "hive",
      // …and the install login is kept only for a future reinstall.
      adminUser: "ops",
    });
    // Storing the connection is not the end of the flow: the accounts screen
    // still has to run, so the installer is still up.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the service account of a resumed run that never reported one", async () => {
    stubTools();
    const client = createMockProvisionClient();
    seedRunningInstall();

    await installTo(client, vi.fn(), successRecords(true));

    expect(getConnection()).toMatchObject({ sshUser: "hive", adminUser: "root" });
  });

  // ── connecting accounts ────────────────────────────────────────────────────

  it("ends on the same cards Settings uses, pointed at the new server", async () => {
    const fetchMock = stubTools();
    seedRunningInstall();

    await installTo(createMockProvisionClient(), vi.fn());

    // Every card addresses the server that was just installed, with the token
    // that server issued — never whatever the client happened to be using.
    const fromNewServer = expect.objectContaining({
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "http://203.0.113.10:9420/api/setup/tools",
        fromNewServer,
      ),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "http://203.0.113.10:9420/api/account/status",
        fromNewServer,
      ),
    );

    // It is the panel, with its sign-ins, not a reduced copy of it. The gh the
    // server also reports is not a harness: its account has its own card, and
    // the panel never renders a tool card for it.
    expect(await screen.findByRole("button", { name: "Connect Claude" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect Codex" })).toBeInTheDocument();
    expect(screen.queryByText("GitHub CLI")).not.toBeInTheDocument();
  });

  it("shows the generated token truncated, reveals it on demand, and copies it whole", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    stubTools();
    seedRunningInstall();

    await installTo(createMockProvisionClient(), vi.fn());

    // On screen it is short enough to recognise and useless to a passer-by.
    const truncated = `${ACCESS_TOKEN.slice(0, 8)}…${ACCESS_TOKEN.slice(-4)}`;
    expect(screen.getByText(truncated)).toBeInTheDocument();
    expect(screen.queryByText(ACCESS_TOKEN)).not.toBeInTheDocument();
    // The server keeps only the digest, so this screen is the one chance at it.
    expect(
      screen.getByText(
        "You'll need it to connect your phone, browser or another machine — it is shown only here and cannot be recovered.",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reveal the access token" }));
    expect(screen.getByText(ACCESS_TOKEN)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hide the access token" }));
    expect(screen.queryByText(ACCESS_TOKEN)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copy" }));

    // What lands on the clipboard is the whole token, never the truncation.
    expect(mocks.copyToClipboard).toHaveBeenCalledWith(ACCESS_TOKEN);
    expect(screen.getByText("Copied")).toBeInTheDocument();
  });

  it("reveals the token and still opens the gate when the clipboard refuses", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    // The other two conditions are already answered by the server, so the only
    // thing between the operator and Open Hive is this copy.
    stubTools({ tools: toolList(true) }, GITHUB_CONNECTED);
    mocks.copyToClipboard.mockRejectedValue(new Error("Write permission denied."));
    seedRunningInstall();

    await installTo(createMockProvisionClient(), vi.fn());
    await screen.findByRole("button", { name: "Connect Codex" });

    await user.click(screen.getByRole("button", { name: "Copy" }));

    // Nothing landed on the clipboard, so the card puts the whole token on
    // screen and says who has to move it.
    expect(screen.getByText(ACCESS_TOKEN)).toBeInTheDocument();
    expect(
      screen.getByText("The clipboard could not be reached. Copy the token above by hand."),
    ).toBeInTheDocument();
    // The failure is not dressed up as a success…
    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
    // …and Copy stays live, so a retry is one click away.
    expect(screen.getByRole("button", { name: "Copy" })).toBeEnabled();

    // The gate asks that the token was surfaced and taken, not that the
    // browser allowed the write: a refused permission must not strand the
    // operator on a screen with no Back and no skip.
    await waitFor(() => expect(screen.queryByText(GATE_HINT)).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Open Hive" })).toBeEnabled();
  });

  it("names the accounts to sign in without repeating the harness rule", async () => {
    stubTools();
    seedRunningInstall();

    await installTo(createMockProvisionClient(), vi.fn());
    await screen.findByRole("button", { name: "Connect Claude" });

    expect(
      screen.getByText(
        "Sign in on the server: GitHub for repository access, and Claude Code or Codex to run sessions. Everything here can be changed later in Settings.",
      ),
    ).toBeInTheDocument();
    // The gate hint below already says either harness will do, so Settings'
    // standing note stays out of the installer rather than saying it twice.
    expect(screen.queryByText(/harness needed to run Hive/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Copy the access token, connect GitHub, sign in to Claude or Codex.",
      ),
    ).toBeInTheDocument();
  });

  it("names everything still missing, and nothing that is done", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    stubTools();
    seedRunningInstall();

    await installTo(createMockProvisionClient(), vi.fn());
    await screen.findByRole("button", { name: "Connect Claude" });

    expect(
      screen.getByText(
        "Copy the access token, connect GitHub, sign in to Claude or Codex.",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copy" }));

    // The item that is done drops out; the rest keep their order.
    expect(
      screen.getByText("Connect GitHub, sign in to Claude or Codex."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Hive" })).toBeDisabled();
  });

  it("asks for a harness by the requirement, never by one of the two cards", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    stubTools({}, GITHUB_CONNECTED);
    seedRunningInstall();

    await installTo(createMockProvisionClient(), vi.fn());
    await user.click(await screen.findByRole("button", { name: "Copy" }));

    // Neither card is required on its own, so neither is named: signing in to
    // either one clears this line.
    expect(
      await screen.findByText("Sign in to Claude or Codex."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Hive" })).toBeDisabled();
  });

  it("treats one connected harness as the whole requirement", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    stubTools({ tools: toolList(true) }, GITHUB_CONNECTED);
    seedRunningInstall();

    await installTo(createMockProvisionClient(), vi.fn());
    await user.click(await screen.findByRole("button", { name: "Copy" }));

    // Codex is still offered, and still not asked for: with Claude signed in
    // the gate is satisfied and nothing is left to do.
    expect(await screen.findByRole("button", { name: "Connect Codex" })).toBeEnabled();
    await waitFor(() => expect(screen.queryByText(GATE_HINT)).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Open Hive" })).toBeEnabled();
  });

  it("opens Hive only once the token is copied, GitHub is connected and a harness is signed in", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    stubTools({ tools: toolList(true) }, GITHUB_CONNECTED);
    const onClose = vi.fn();
    seedRunningInstall();

    await installTo(createMockProvisionClient(), onClose);
    await screen.findByRole("button", { name: "Connect Codex" });

    // The server answers two of the three; the copy is the operator's own.
    const open = screen.getByRole("button", { name: "Open Hive" });
    expect(await screen.findByText("Copy the access token.")).toBeInTheDocument();
    expect(open).toBeDisabled();
    // The install is over, so there is no back — and no skip or later either.
    // The only way out is through the three things the gate asks for.
    for (const label of [/back/i, /skip/i, /later/i, /retry/i]) {
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    }

    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(screen.queryByText(GATE_HINT)).not.toBeInTheDocument();
    expect(open).toBeEnabled();
    await user.click(open);

    // Finishing closes the installer and hands over to the ordinary app…
    expect(onClose).toHaveBeenCalledTimes(1);
    // …with the connection it installed intact.
    expect(getConnection()).toMatchObject({ host: "203.0.113.10", port: 9420 });
    // Nothing of the run survives to be resumed.
    expect(localStorage.getItem(INSTALLER_STORAGE_KEY)).toBe(
      JSON.stringify({ schema: INSTALLER_SCHEMA, state: "welcome", inputs: defaultInputs() }),
    );
  });

  it("does not resume onto the accounts screen after a relaunch", () => {
    seed("accounts", { privilegeMode: "root" });

    // The install is over and the connection is stored; everything that screen
    // offered lives in Settings, which is where a relaunched app finds it.
    expect(loadMachine().state).toBe("welcome");
  });

  it("leaves an existing connection untouched when a re-launched installer is abandoned", async () => {
    replaceConnection({ host: "100.64.0.10", port: 9420, authToken: "old", sshUser: "hive" });
    const before = localStorage.getItem(CONNECTION_STORAGE_KEY);
    const onClose = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createMockProvisionClient();
    render(<Installer client={client} onClose={onClose} cancellable />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(CONNECTION_STORAGE_KEY)).toBe(before);
  });
});
