import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ClaudeSignIn, ToolsPanel } from "@/pages/setup/screens/ToolsPanel";
import { createMockProvisionClient } from "./mock-provision-client";

describe("ClaudeSignIn", () => {
  it("offers only the manual token path without a desktop provision client", () => {
    render(<ClaudeSignIn submitToken={async () => {}} onError={() => {}} />);

    expect(screen.queryByRole("button", { name: "Sign in with Claude" })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("sk-ant-oat01-…")).toBeInTheDocument();
  });

  it("cancels the local Claude PTY when the screen closes", async () => {
    const client = createMockProvisionClient();
    client.pollClaudeAuth = vi.fn().mockResolvedValue({ exited: false });
    const cancel = vi.spyOn(client, "cancelClaudeAuth");
    const view = render(
      <ClaudeSignIn client={client} submitToken={async () => {}} onError={() => {}} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Sign in with Claude" }));
    await waitFor(() => expect(screen.getByPlaceholderText("Paste the authorization code")).toBeInTheDocument());
    view.unmount();

    expect(cancel).toHaveBeenCalledOnce();
  });

  it("lets Claude authentication restart without rerunning the installer", async () => {
    const client = createMockProvisionClient();
    client.startClaudeAuth = vi.fn()
      .mockRejectedValueOnce(new Error("browser callback failed"))
      .mockResolvedValueOnce({ url: "https://claude.ai/oauth/mock" });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          detected: {
            gh: { installed: true, authenticated: true },
            claude: { installed: true, authenticated: false },
            codex: { installed: true, authenticated: true },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(<ToolsPanel client={client} baseUrl="http://100.64.0.10:3000" />);
    await userEvent.click(await screen.findByRole("button", { name: "Sign in with Claude" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("browser callback failed");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Sign in with Claude" }));

    expect(await screen.findByPlaceholderText("Paste the authorization code")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(client.startClaudeAuth).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/setup/run"),
      expect.anything(),
    );
  });
});
