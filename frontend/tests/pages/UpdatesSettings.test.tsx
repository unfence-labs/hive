import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UpdatesSettings from "@/pages/settings/UpdatesSettings";
import { resetDesktopUpdateForTests } from "@/hooks/useDesktopUpdate";
import { createWrapper } from "../test-utils";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  invoke: vi.fn(),
  check: vi.fn(),
}));

vi.mock("@/hooks/useApi", () => ({ api: { get: mocks.get } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));

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

beforeEach(() => {
  vi.clearAllMocks();
  resetDesktopUpdateForTests();
  mocks.get.mockResolvedValue({ version: "1.2.3" });
  mocks.invoke.mockResolvedValue("1.2.3");
  mocks.check.mockResolvedValue(null);
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

  it("shows the app version on desktop without an update hint when versions match", async () => {
    setDesktopShell(true);
    renderPage();

    expect(await screen.findByRole("heading", { name: "Application" })).toBeInTheDocument();
    expect(await screen.findAllByText("Version 1.2.3")).toHaveLength(2);
    expect(screen.queryByText(/provision\.sh/)).not.toBeInTheDocument();
  });

  it("offers the server update command when the backend lags the app", async () => {
    setDesktopShell(true);
    mocks.invoke.mockResolvedValue("1.3.0-beta.2");
    renderPage();

    expect(
      await screen.findByText(/releases\/download\/v1\.3\.0-beta\.2\/provision\.sh/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy update command" })).toBeInTheDocument();
  });

  it("never suggests updating a dev backend", async () => {
    setDesktopShell(true);
    mocks.get.mockResolvedValue({ version: "dev" });
    mocks.invoke.mockResolvedValue("1.3.0");
    renderPage();

    expect(await screen.findByText("Version dev")).toBeInTheDocument();
    expect(screen.queryByText(/provision\.sh/)).not.toBeInTheDocument();
  });

  it("runs a manual check from the button and reports up to date", async () => {
    setDesktopShell(true);
    vi.stubEnv("PROD", true);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Check for updates" }));

    expect(mocks.check).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("You're on the latest version.")).toBeInTheDocument();
  });
});
