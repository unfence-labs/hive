import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProvisioningScreen } from "@/pages/setup/screens/ProvisioningScreen";
import { createMockProvisionClient } from "@/lib/provision-client";

const params = { host: "1.2.3.4", keyPath: "/k", tailscaleAuthKey: "tskey-auth-x" };

describe("ProvisioningScreen", () => {
  it("renders the checklist and completes on the happy path", async () => {
    const client = createMockProvisionClient("happy");
    const onDone = vi.fn();
    render(
      <ProvisioningScreen
        client={client}
        params={params}
        onDone={onDone}
        onBack={() => {}}
        onContinueLater={() => {}}
        onStartOver={() => {}}
      />,
    );
    // Steps from the happy scenario appear.
    await waitFor(() => expect(screen.getByText("Join the tailnet")).toBeInTheDocument());
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("shows an error panel with Retry on the error path, and resume succeeds", async () => {
    const client = createMockProvisionClient("error");
    const resumeSpy = vi.spyOn(client, "resumeProvision");
    const onDone = vi.fn();
    render(
      <ProvisioningScreen
        client={client}
        params={params}
        onDone={onDone}
        onBack={() => {}}
        onContinueLater={() => {}}
        onStartOver={() => {}}
      />,
    );

    // Error surfaces with the taxonomy code and a Retry button.
    await waitFor(() => expect(screen.getByText("TS_AUTHKEY_INVALID")).toBeInTheDocument());
    const retry = screen.getByRole("button", { name: /retry/i });

    await userEvent.click(retry);

    // Retry calls resumeProvision with the full params and the run completes.
    await waitFor(() => expect(resumeSpy).toHaveBeenCalledWith(params));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});
