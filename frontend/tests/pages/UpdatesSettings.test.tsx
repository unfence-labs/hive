import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UpdatesSettings from "@/pages/settings/UpdatesSettings";
import { resetDesktopUpdateForTests } from "@/hooks/useDesktopUpdate";
import { resetServerUpdate } from "@/lib/server-update";
import { getConnection, replaceConnection } from "@/hooks/useConnection";
import type { ProvisionClient } from "@/lib/provision-client";
import { createWrapper } from "../test-utils";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  invoke: vi.fn(),
  check: vi.fn(),
  install: vi.fn(),
  listKeys: vi.fn(),
  liveData: {} as Record<string, { status?: "idle" | "busy" }>,
}));

vi.mock("@/hooks/useApi", () => ({ api: { get: mocks.get } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("@/contexts/WorkspaceLiveDataContext", () => ({
  useWorkspaceLiveDataContext: () => mocks.liveData,
}));
vi.mock("@/lib/provision-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/provision-client")>()),
  createTauriProvisionClient: (): ProvisionClient => ({
    listKeys: mocks.listKeys,
    testConnection: vi.fn(),
    trustHost: vi.fn(),
    preflight: vi.fn(),
    install: mocks.install,
  }),
}));

function setDesktopShell(enabled: boolean) {
  const globals = window as unknown as Record<string, unknown>;
  if (enabled) globals.__TAURI_INTERNALS__ = {};
  else delete globals.__TAURI_INTERNALS__;
}

function renderPage() {
  const { wrapper: Wrapper } = createWrapper();
  render(
    <Wrapper>
      <UpdatesSettings />
    </Wrapper>,
  );
}

function seedConnection(overrides: Record<string, unknown> = {}) {
  replaceConnection({
    host: "203.0.113.10",
    port: 9420,
    authToken: "token",
    adminUser: "root",
    sshKeyPath: "/home/lenny/.ssh/id_ed25519",
    ...overrides,
  });
}

/** A desktop app on 1.3.0-beta.2 talking to a backend still on 1.2.3. */
function seedMismatch() {
  setDesktopShell(true);
  seedConnection();
  mocks.invoke.mockResolvedValue("1.3.0-beta.2");
}

beforeEach(() => {
  // reset, not clear: a test that aborts mid-flow leaves unconsumed
  // mock*Once implementations behind, and clear would keep them queued.
  vi.resetAllMocks();
  localStorage.clear();
  resetDesktopUpdateForTests();
  resetServerUpdate();
  mocks.liveData = {};
  mocks.get.mockResolvedValue({ version: "1.2.3" });
  mocks.invoke.mockResolvedValue("1.2.3");
  mocks.check.mockResolvedValue(null);
  mocks.install.mockResolvedValue(undefined);
  mocks.listKeys.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  setDesktopShell(false);
});

describe("UpdatesSettings", () => {
  it("shows only the server version on the web", async () => {
    renderPage();

    expect(await screen.findByText("Version 1.2.3")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Application" })).not.toBeInTheDocument();
  });

  it("reports an unreachable server", async () => {
    mocks.get.mockRejectedValue(new Error("down"));
    renderPage();

    expect(await screen.findByText("Version unavailable")).toBeInTheDocument();
  });

  it("shows no server action when versions match", async () => {
    setDesktopShell(true);
    seedConnection();
    renderPage();

    expect(await screen.findByRole("heading", { name: "Application" })).toBeInTheDocument();
    expect(await screen.findAllByText("Version 1.2.3")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Update server/ })).not.toBeInTheDocument();
  });

  it("never suggests updating a dev backend", async () => {
    setDesktopShell(true);
    seedConnection();
    mocks.get.mockResolvedValue({ version: "dev" });
    mocks.invoke.mockResolvedValue("1.3.0");
    renderPage();

    expect(await screen.findByText("Version dev")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Update server/ })).not.toBeInTheDocument();
  });

  it("runs a manual check from the button and reports up to date", async () => {
    setDesktopShell(true);
    seedConnection();
    vi.stubEnv("PROD", true);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Check for updates" }));

    expect(mocks.check).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("You're on the latest version.")).toBeInTheDocument();
  });

  it("updates the server in place when the backend differs from the app", async () => {
    seedMismatch();
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Update server to 1.3.0-beta.2" }));

    await waitFor(() => expect(screen.getByText("Server updated.")).toBeInTheDocument());
    expect(mocks.install).toHaveBeenCalledWith(
      {
        connection: {
          host: "203.0.113.10",
          user: "root",
          keyPath: "/home/lenny/.ssh/id_ed25519",
        },
        options: { update: true },
        password: undefined,
      },
      expect.any(Function),
    );
  });

  it("hides the server update while an app update is pending", async () => {
    seedMismatch();
    vi.stubEnv("PROD", true);
    mocks.check.mockResolvedValue({
      version: "1.4.0",
      downloadAndInstall: vi.fn(),
      close: vi.fn(async () => {}),
    });
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole("button", { name: /Update server/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Check for updates" }));

    expect(await screen.findByText("Version 1.4.0 is available.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Update server/ })).not.toBeInTheDocument();
  });

  it("warns before restarting a server with busy workspaces", async () => {
    seedMismatch();
    // Live WS state, not the projects query — the query snapshot can be stale.
    mocks.liveData = { w1: { status: "busy" }, w2: { status: "idle" } };
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /Update server/ }));
    expect(mocks.install).not.toHaveBeenCalled();
    expect(screen.getByText(/1 workspace has agents running/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Update anyway" }));
    await waitFor(() => expect(mocks.install).toHaveBeenCalledTimes(1));
  });

  it("asks for the SSH key once when the stored connection has none", async () => {
    seedMismatch();
    seedConnection({ sshKeyPath: undefined });
    mocks.listKeys.mockResolvedValue([
      { path: "/home/lenny/.ssh/id_ed25519", label: "id_ed25519", encrypted: false, agentLoaded: false, usable: true },
      { path: "/home/lenny/.ssh/id_rsa", label: "id_rsa", encrypted: true, agentLoaded: false, usable: false },
    ]);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /Update server/ }));
    expect(await screen.findByText("Select an SSH key")).toBeInTheDocument();
    // Passphrase-protected keys cannot authenticate non-interactively.
    expect(screen.queryByText("id_rsa")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /id_ed25519/ }));

    await waitFor(() => expect(mocks.install).toHaveBeenCalledTimes(1));
    expect(mocks.install.mock.calls[0][0].connection.keyPath).toBe("/home/lenny/.ssh/id_ed25519");
    expect(getConnection()?.sshKeyPath).toBe("/home/lenny/.ssh/id_ed25519");
  });

  it("collects the escalation password when the server requires one", async () => {
    seedMismatch();
    mocks.install
      .mockRejectedValueOnce({ code: "SSH_PASSWORD_REQUIRED", detail: "password needed" })
      .mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /Update server/ }));
    expect(await screen.findByRole("heading", { name: "Escalation password" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("Password"), "hunter2");
    await user.click(screen.getByRole("button", { name: "Update server" }));

    await waitFor(() => expect(screen.getByText("Server updated.")).toBeInTheDocument());
    expect(mocks.install).toHaveBeenCalledTimes(2);
    expect(mocks.install.mock.calls[1][0].password).toBe("hunter2");
  });

  it("offers the manual command as a fallback after a failed run", async () => {
    seedMismatch();
    mocks.install.mockRejectedValue({ code: "HEALTH_TIMEOUT", detail: "no health" });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /Update server/ }));

    expect(await screen.findByText("Update failed: no health")).toBeInTheDocument();
    expect(
      screen.getByText(/releases\/download\/v1\.3\.0-beta\.2\/provision\.sh/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Update server/ })).toBeInTheDocument();
  });
});
