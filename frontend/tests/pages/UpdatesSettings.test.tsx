import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UpdatesSettings from "@/pages/settings/UpdatesSettings";
import { UpdateDialogs } from "@/components/UpdateDialogs";
import type { DesktopUpdateState } from "@/hooks/useDesktopUpdate";
import { createWrapper } from "../test-utils";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  check: vi.fn(),
  install: vi.fn(),
  respond: vi.fn(),
  dismiss: vi.fn(),
  manual: false,
  desktop: true,
  production: true,
  state: { phase: "idle" } as DesktopUpdateState,
}));
vi.mock("@/hooks/useApi", () => ({ api: { get: mocks.get } }));
vi.mock("@/hooks/useAppVersion", () => ({ useAppVersion: () => "1.2.3" }));
vi.mock("@/lib/is-desktop", () => ({ isDesktopShell: () => mocks.desktop }));
vi.mock("@/hooks/useDesktopUpdate", () => ({
  useDesktopUpdateState: () => mocks.state,
  shouldCheckForUpdates: () => mocks.desktop && mocks.production,
  checkForUpdatesNow: mocks.check,
  installCurrentUpdate: mocks.install,
  respondToUpdate: mocks.respond,
  dismissUpdateInput: mocks.dismiss,
  useServerCompatibility: () => ({
    appVersion: "1.2.3",
    phase: "ready",
    server: {
      version: "1.2.3",
      updateMethod: mocks.manual ? "manual" : "provisioner",
    },
  }),
}));
function renderPage() {
  const { wrapper } = createWrapper();
  return render(
    <>
      <UpdatesSettings />
      <UpdateDialogs />
    </>,
    { wrapper },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.manual = false;
  mocks.desktop = true;
  mocks.production = true;
  mocks.state = { phase: "idle" };
  mocks.get.mockResolvedValue({
    version: "1.2.3",
    updateMethod: "provisioner",
  });
});
describe("UpdatesSettings", () => {
  it("shows only the server on the web", async () => {
    mocks.desktop = false;
    renderPage();
    expect(await screen.findByText("Version 1.2.3")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Check for updates" }),
    ).not.toBeInTheDocument();
  });
  it("checks through the shared coordinator", async () => {
    renderPage();
    await userEvent.click(
      screen.getByRole("button", { name: "Check for updates" }),
    );
    expect(mocks.check).toHaveBeenCalledOnce();
  });
  it("offers only one coordinated action when a release is available", async () => {
    mocks.state = { phase: "available", version: "1.4.0" };
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Update Hive" }));
    expect(mocks.install).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", { name: /Update server|Check for updates/ }),
    ).not.toBeInTheDocument();
  });
  it("explains manual server updates and keeps the app action available", async () => {
    mocks.manual = true;
    mocks.manual = true;
    mocks.get.mockResolvedValue({ version: "1.2.0", updateMethod: "manual" });
    mocks.state = { phase: "available", version: "1.4.0" };
    renderPage();
    expect(
      await screen.findByText(/This server was installed manually/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Update Hive" }),
    ).toBeInTheDocument();
  });
  it("shows backend progress without an update or cancel action", () => {
    mocks.state = {
      phase: "updatingServer",
      version: "1.4.0",
      step: "Restarting",
    };
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("Restarting");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("offers explicit resume through the same coordinator", async () => {
    mocks.state = { phase: "resume", version: "1.4.0" };
    renderPage();
    await userEvent.click(
      screen.getByRole("button", { name: "Resume update" }),
    );
    expect(mocks.install).toHaveBeenCalledOnce();
  });
  it("preserves the running-agents confirmation", async () => {
    mocks.state = {
      phase: "input",
      version: "1.4.0",
      kind: "agents",
      busyWorkspaces: 2,
    };
    renderPage();
    expect(
      screen.getByText(/2 workspaces have agents running/),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Update anyway" }),
    );
    expect(mocks.respond).toHaveBeenCalledWith({ confirmAgents: true });
  });
  it("confirms the restart without inventing a busy count when workspaces have not loaded", async () => {
    mocks.state = { phase: "input", version: "1.4.0", kind: "agents" };
    renderPage();
    expect(
      screen.getByRole("heading", { name: "Restart the server?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Updating restarts the server and stops any running agents.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/0 workspaces/)).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Update anyway" }),
    );
    expect(mocks.respond).toHaveBeenCalledWith({ confirmAgents: true });
  });
  it("passes a selected SSH key to the coordinator", async () => {
    mocks.state = {
      phase: "input",
      version: "1.4.0",
      kind: "key",
      keys: [
        {
          path: "/keys/test",
          label: "test",
          usable: true,
          encrypted: false,
          agentLoaded: false,
        },
      ],
    };
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "test" }));
    expect(mocks.respond).toHaveBeenCalledWith({ keyPath: "/keys/test" });
  });
  it("collects the escalation password", async () => {
    mocks.state = { phase: "input", version: "1.4.0", kind: "password" };
    renderPage();
    await userEvent.type(screen.getByLabelText("Password"), "secret");
    await userEvent.click(
      screen.getByRole("button", { name: "Update server" }),
    );
    expect(mocks.respond).toHaveBeenCalledWith({ password: "secret" });
  });
});
