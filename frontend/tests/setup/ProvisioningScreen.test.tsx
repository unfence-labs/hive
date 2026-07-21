import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProvisioningScreen } from "@/pages/setup/screens/ProvisioningScreen";
import { createMockProvisionClient } from "./mock-provision-client";

const params = { host: "1.2.3.4", keyPath: "/k", tailscaleAuthKey: "tskey-auth-x", skipTailscale: false };

describe("ProvisioningScreen", () => {
  it("renders the checklist and completes on the happy path", async () => {
    const client = createMockProvisionClient("happy");
    const onDone = vi.fn();
    render(
      <ProvisioningScreen
        client={client}
        params={{ ...params, host: "1.2.3.5" }}
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

  it("shows an error panel and retries through the same idempotent start command", async () => {
    const client = createMockProvisionClient("error");
    const startSpy = vi.spyOn(client, "startProvision");
    const onDone = vi.fn();
    render(
      <ProvisioningScreen
        client={client}
        params={{ ...params, host: "1.2.3.6" }}
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

    await waitFor(() => expect(startSpy).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("starts only one run when React StrictMode remounts effects", async () => {
    const client = createMockProvisionClient("happy");
    const startSpy = vi.spyOn(client, "startProvision");
    render(
      <StrictMode>
        <ProvisioningScreen
          client={client}
          params={{ ...params, host: "1.2.3.7" }}
          onDone={() => {}}
          onBack={() => {}}
          onContinueLater={() => {}}
          onStartOver={() => {}}
        />
      </StrictMode>,
    );
    await waitFor(() => expect(screen.getByText("Start Hive")).toBeInTheDocument());
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh run when a completed same-host screen is mounted again", async () => {
    const client = createMockProvisionClient("happy");
    const startSpy = vi.spyOn(client, "startProvision");
    const props = {
      client,
      params: { ...params, host: "1.2.3.8" },
      onDone: vi.fn(),
      onBack: () => {},
      onContinueLater: () => {},
      onStartOver: () => {},
    };
    const first = render(<ProvisioningScreen {...props} />);
    await waitFor(() => expect(props.onDone).toHaveBeenCalledTimes(1));
    first.unmount();

    render(<ProvisioningScreen {...props} />);
    await waitFor(() => expect(startSpy).toHaveBeenCalledTimes(2));
  });

  it("reattaches to an active run after reopening with a fresh client", async () => {
    const firstClient = createMockProvisionClient({
      events: [
        {
          kind: "run_start",
          seq: 0,
          runId: "active-run",
          scriptVersion: "0.3.0",
          resume: false,
          stepsPlanned: ["probe_os"],
        },
        { kind: "step_start", seq: 1, step: "probe_os", title: "Check server OS" },
        { kind: "step_ok", seq: 2, step: "probe_os" },
        { kind: "run_end", seq: 3, status: "ok" },
      ],
      delayMs: 25,
    });
    const secondClient = createMockProvisionClient("happy");
    const firstStart = vi.spyOn(firstClient, "startProvision");
    const secondStart = vi.spyOn(secondClient, "startProvision");
    const runParams = { ...params, host: "1.2.3.9" };
    const first = render(
      <ProvisioningScreen
        client={firstClient}
        params={runParams}
        onDone={() => {}}
        onBack={() => {}}
        onContinueLater={() => {}}
        onStartOver={() => {}}
      />,
    );
    await waitFor(() => expect(firstStart).toHaveBeenCalledTimes(1));
    first.unmount();

    const onDone = vi.fn();
    render(
      <ProvisioningScreen
        client={secondClient}
        params={runParams}
        onDone={onDone}
        onBack={() => {}}
        onContinueLater={() => {}}
        onStartOver={() => {}}
      />,
    );

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(secondStart).not.toHaveBeenCalled();
  });
});
