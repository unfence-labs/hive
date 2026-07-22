import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SetupWizard } from "@/pages/setup/SetupWizard";
import { createMockProvisionClient } from "./mock-provision-client";
import { SETUP_STATE_STORAGE_KEY, loadMachineState } from "@/pages/setup/machine";

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("SetupWizard", () => {
  it("advances from welcome and persists progress", async () => {
    const client = createMockProvisionClient("happy");
    render(<SetupWizard client={client} />);

    expect(screen.getByText("Set up a Hive server")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /get started/i }));

    await waitFor(() => expect(screen.getByText("Connect the server to Tailscale")).toBeInTheDocument());
    expect(loadMachineState().state).toBe("tailscale");
  });

  it("can leave the welcome screen to connect an existing server", async () => {
    const onConnectExisting = vi.fn();
    render(
      <SetupWizard
        client={createMockProvisionClient("happy")}
        onConnectExisting={onConnectExisting}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /connect to an existing server/i }));

    expect(onConnectExisting).toHaveBeenCalledOnce();
  });

  it("supports back navigation", async () => {
    const client = createMockProvisionClient("happy");
    render(<SetupWizard client={client} />);

    await userEvent.click(screen.getByRole("button", { name: /get started/i }));
    await waitFor(() => expect(screen.getByText("Connect the server to Tailscale")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /back/i }));
    await waitFor(() => expect(screen.getByText("Set up a Hive server")).toBeInTheDocument());
  });

  it("asks for the non-persisted Tailscale key again before resuming provisioning", () => {
    localStorage.setItem(
      SETUP_STATE_STORAGE_KEY,
      JSON.stringify({ schema: 2, state: "server", inputs: { sshKeyPath: "/key" }, error: null }),
    );
    const client = createMockProvisionClient("happy");
    render(<SetupWizard client={client} />);
    expect(screen.getByText("Connect the server to Tailscale")).toBeInTheDocument();
  });

  it("validates the tailscale key before allowing continue", async () => {
    localStorage.setItem(
      SETUP_STATE_STORAGE_KEY,
      JSON.stringify({ schema: 2, state: "tailscale", inputs: {}, error: null }),
    );
    const client = createMockProvisionClient("happy");
    render(<SetupWizard client={client} />);

    const continueBtn = screen.getByRole("button", { name: "Continue" });
    expect(continueBtn).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Tailscale auth key"), "tskey-auth-abc123CNTRL-s3cr3t");
    await waitFor(() => expect(continueBtn).toBeEnabled());
  });

  it("resets version 1 wizard state", () => {
    localStorage.setItem(
      SETUP_STATE_STORAGE_KEY,
      JSON.stringify({ schema: 1, state: "server_choice", inputs: {}, error: null }),
    );
    render(<SetupWizard client={createMockProvisionClient()} />);
    expect(screen.getByText("Set up a Hive server")).toBeInTheDocument();
  });

  it("cancels the active provision run when starting over", async () => {
    localStorage.setItem(
      SETUP_STATE_STORAGE_KEY,
      JSON.stringify({
        schema: 2,
        state: "provisioning",
        inputs: { skipTailscale: true, sshKeyPath: "/home/user/.ssh/id_ed25519", serverIp: "203.0.113.7" },
        error: null,
      }),
    );
    const client = createMockProvisionClient({
      events: [
        {
          kind: "run_start",
          seq: 0,
          runId: "r-abandon",
          scriptVersion: "0.3.0",
          resume: false,
          stepsPlanned: ["probe_os"],
        },
      ],
      delayMs: 10_000,
    });
    const cancelSpy = vi.spyOn(client, "cancelProvision");
    render(<SetupWizard client={client} />);

    await waitFor(() => expect(screen.getByText("Installing Hive on your server")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Start over" }));
    const dialog = screen.getByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Start over" }));

    expect(cancelSpy).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByText("Set up a Hive server")).toBeInTheDocument());
  });

  it("cancels the active provision run when continuing later", async () => {
    localStorage.setItem(
      SETUP_STATE_STORAGE_KEY,
      JSON.stringify({
        schema: 2,
        state: "provisioning",
        inputs: { skipTailscale: true, sshKeyPath: "/home/user/.ssh/id_ed25519", serverIp: "203.0.113.8" },
        error: null,
      }),
    );
    const client = createMockProvisionClient({
      events: [
        {
          kind: "run_start",
          seq: 0,
          runId: "r-abandon-later",
          scriptVersion: "0.3.0",
          resume: false,
          stepsPlanned: ["probe_os"],
        },
      ],
      delayMs: 10_000,
    });
    const cancelSpy = vi.spyOn(client, "cancelProvision");
    const onComplete = vi.fn();
    render(<SetupWizard client={client} onComplete={onComplete} />);

    await waitFor(() => expect(screen.getByText("Installing Hive on your server")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Continue later" }));

    expect(cancelSpy).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledOnce();
  });
});
