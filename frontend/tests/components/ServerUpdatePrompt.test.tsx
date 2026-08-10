import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ServerUpdatePrompt } from "@/components/ServerUpdatePrompt";
import { resetServerUpdate } from "@/lib/server-update";
import { replaceConnection } from "@/hooks/useConnection";
import { createWrapper } from "../test-utils";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  invoke: vi.fn(),
  custom: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock("@/hooks/useApi", () => ({ api: { get: mocks.get } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("sonner", () => ({
  Toaster: () => null,
  toast: { custom: mocks.custom, dismiss: mocks.dismiss },
}));

function setDesktopShell(enabled: boolean) {
  const globals = window as unknown as Record<string, unknown>;
  if (enabled) globals.__TAURI_INTERNALS__ = {};
  else delete globals.__TAURI_INTERNALS__;
}

function renderPrompt() {
  const { wrapper: Wrapper } = createWrapper();
  return render(
    <Wrapper>
      <MemoryRouter>
        <ServerUpdatePrompt />
      </MemoryRouter>
    </Wrapper>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetServerUpdate();
  setDesktopShell(true);
  replaceConnection({ host: "203.0.113.10", port: 9420, authToken: "token" });
  mocks.get.mockResolvedValue({ version: "1.2.3" });
  mocks.invoke.mockResolvedValue("1.3.0");
});

afterEach(() => {
  setDesktopShell(false);
});

describe("ServerUpdatePrompt", () => {
  it("prompts once per launch when the server differs from the app", async () => {
    const first = renderPrompt();
    await waitFor(() => expect(mocks.custom).toHaveBeenCalledTimes(1));

    first.unmount();
    renderPrompt();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.custom).toHaveBeenCalledTimes(1);
  });

  it("stays silent when versions match, on dev backends, and on the web", async () => {
    mocks.invoke.mockResolvedValue("1.2.3");
    renderPrompt();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.custom).not.toHaveBeenCalled();

    mocks.get.mockResolvedValue({ version: "dev" });
    mocks.invoke.mockResolvedValue("1.3.0");
    renderPrompt();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.custom).not.toHaveBeenCalled();

    setDesktopShell(false);
    renderPrompt();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.custom).not.toHaveBeenCalled();
  });
});
