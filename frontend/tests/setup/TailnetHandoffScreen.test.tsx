import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TailnetHandoffScreen } from "@/pages/setup/screens/TailnetHandoffScreen";
import { createMockProvisionClient } from "./mock-provision-client";

describe("TailnetHandoffScreen", () => {
  it("retries only tailnet host trust before checking health", async () => {
    const client = createMockProvisionClient("happy");
    const trustHost = vi.spyOn(client, "trustHost")
      .mockRejectedValueOnce(new Error("SSH_UNREACHABLE: keyscan timed out"))
      .mockResolvedValueOnce(undefined);
    const checkHealth = vi.fn().mockResolvedValue(true);
    const onContinue = vi.fn();

    render(
      <TailnetHandoffScreen
        client={client}
        host="100.64.0.20"
        expectedHostKey="public-host ssh-ed25519 AAAA"
        baseUrl="http://100.64.0.20:3000"
        onContinue={onContinue}
        onContinueLater={() => {}}
        checkHealth={checkHealth}
      />,
    );

    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    expect(await screen.findByText("SSH_UNREACHABLE")).toBeInTheDocument();
    expect(checkHealth).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.getByText("Your server is online")).toBeInTheDocument());
    expect(trustHost).toHaveBeenCalledTimes(2);
    expect(checkHealth).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalledOnce();
  });
});
