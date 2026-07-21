import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HostTrustScreen } from "@/pages/setup/screens/HostTrustScreen";
import { ServerIpScreen } from "@/pages/setup/screens/ServerIpScreen";
import { SshKeyScreen } from "@/pages/setup/screens/SshKeyScreen";
import { createMockProvisionClient } from "./mock-provision-client";

describe("SSH setup screens", () => {
  it("shows key discovery failures instead of leaving a loading screen", async () => {
    const client = createMockProvisionClient();
    client.listKeys = vi.fn().mockRejectedValue(new Error("ssh-keygen missing"));

    render(
      <SshKeyScreen
        client={client}
        onContinue={() => {}}
        onBack={() => {}}
        onContinueLater={() => {}}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("ssh-keygen missing");
  });

  it("requires encrypted keys to be loaded in ssh-agent", async () => {
    const client = createMockProvisionClient();
    client.listKeys = vi.fn().mockResolvedValue([
      { path: "/home/user/.ssh/locked", label: "locked", encrypted: true, agentLoaded: false },
    ]);

    render(
      <SshKeyScreen
        client={client}
        onContinue={() => {}}
        onBack={() => {}}
        onContinueLater={() => {}}
      />,
    );

    expect(await screen.findByRole("radio")).toBeDisabled();
    expect(screen.getByText("ssh-add /home/user/.ssh/locked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("maps connection command failures to SSH_UNREACHABLE", async () => {
    const client = createMockProvisionClient();
    client.testConnection = vi.fn().mockRejectedValue(new Error("command failed"));
    const onError = vi.fn();

    render(
      <ServerIpScreen
        client={client}
        onContinue={() => {}}
        onBack={() => {}}
        onContinueLater={() => {}}
        onError={onError}
      />,
    );
    await userEvent.type(screen.getByLabelText("Server IP or hostname"), "root@203.0.113.10");
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith("SSH_UNREACHABLE"));
  });

  it("shows known-host persistence failures and does not advance", async () => {
    const client = createMockProvisionClient();
    client.trustHost = vi.fn().mockRejectedValue(new Error("known_hosts is read-only"));
    const onContinue = vi.fn();

    render(
      <HostTrustScreen
        client={client}
        host="203.0.113.10"
        fingerprint="SHA256:test"
        hostKey="203.0.113.10 ssh-ed25519 AAAA"
        onContinue={onContinue}
        onBack={() => {}}
        onContinueLater={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Trust and continue" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("known_hosts is read-only");
    expect(onContinue).not.toHaveBeenCalled();
  });
});
