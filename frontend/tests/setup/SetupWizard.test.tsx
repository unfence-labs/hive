import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SetupWizard, generateAuthToken } from "@/pages/setup/SetupWizard";
import { createMockProvisionClient } from "@/lib/provision-client";
import { SETUP_STATE_STORAGE_KEY, loadMachineState } from "@/pages/setup/machine";

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("SetupWizard", () => {
  it("generates a URL-safe auth token", () => {
    const t = generateAuthToken();
    expect(t).toMatch(/^hive_[0-9a-f]{64}$/);
    expect(generateAuthToken()).not.toBe(t);
  });

  it("advances from welcome and persists progress", async () => {
    const client = createMockProvisionClient("happy");
    render(<SetupWizard client={client} />);

    expect(screen.getByText("Set up a Hive server")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /get started/i }));

    // Now on tailscale_intro.
    await waitFor(() => expect(screen.getByText("Create your Tailscale network")).toBeInTheDocument());
    expect(loadMachineState().state).toBe("tailscale_intro");
  });

  it("supports back navigation", async () => {
    const client = createMockProvisionClient("happy");
    render(<SetupWizard client={client} />);

    await userEvent.click(screen.getByRole("button", { name: /get started/i }));
    await waitFor(() => expect(screen.getByText("Create your Tailscale network")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /back/i }));
    await waitFor(() => expect(screen.getByText("Set up a Hive server")).toBeInTheDocument());
  });

  it("resumes mid-flow after a reload from persisted state", () => {
    localStorage.setItem(
      SETUP_STATE_STORAGE_KEY,
      JSON.stringify({ schema: 1, state: "server_choice", inputs: { tailscaleAuthKey: "tskey-auth-z" }, error: null }),
    );
    const client = createMockProvisionClient("happy");
    render(<SetupWizard client={client} />);
    expect(screen.getByText("Do you have a server?")).toBeInTheDocument();
  });

  it("validates the tailscale key before allowing continue", async () => {
    localStorage.setItem(
      SETUP_STATE_STORAGE_KEY,
      JSON.stringify({ schema: 1, state: "tailscale_key", inputs: {}, error: null }),
    );
    const client = createMockProvisionClient("happy");
    render(<SetupWizard client={client} />);

    const continueBtn = screen.getByRole("button", { name: "Continue" });
    expect(continueBtn).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Tailscale auth key"), "tskey-auth-abc123");
    await waitFor(() => expect(continueBtn).toBeEnabled());
  });
});
