import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SettingsView from "@/pages/SettingsView";

const setAccent = vi.fn();

vi.mock("@/hooks/useAccentColor", () => ({
  useAccentColor: () => ({
    accentId: "blue",
    setAccent,
    options: [
      { id: "blue", label: "Blue", color: "#3b82f6" },
      { id: "emerald", label: "Emerald", color: "#10b981" },
    ],
  }),
}));

describe("SettingsView", () => {
  beforeEach(() => {
    setAccent.mockReset();
    localStorage.removeItem("hive-server-url");
    localStorage.removeItem("hive-vps-target");
  });

  it("shows default local address and empty VPS target", () => {
    render(<SettingsView />);

    expect(screen.getByPlaceholderText("http://localhost:3000")).toHaveValue("http://localhost:3000");
    expect(screen.getByPlaceholderText("user@192.168.1.1")).toHaveValue("");
  });

  it("persists local address on Enter and trims trailing slash", async () => {
    const user = userEvent.setup();
    render(<SettingsView />);

    const localAddressInput = screen.getByPlaceholderText("http://localhost:3000");
    await user.clear(localAddressInput);
    await user.type(localAddressInput, "  http://localhost:4567///");
    expect(screen.getByText("unsaved")).toBeInTheDocument();

    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(localStorage.getItem("hive-server-url")).toBe("http://localhost:4567");
    });
    expect(localAddressInput).toHaveValue("  http://localhost:4567///");
  });

  it("persists VPS target and renders ssh tunnel command with local port", async () => {
    const user = userEvent.setup();
    render(<SettingsView />);

    const localAddressInput = screen.getByPlaceholderText("http://localhost:3000");
    await user.clear(localAddressInput);
    await user.type(localAddressInput, "http://localhost:7000");
    await user.keyboard("{Enter}");

    const vpsTargetInput = screen.getByPlaceholderText("user@192.168.1.1");
    await user.type(vpsTargetInput, "  deploy@vps.example.com  ");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(localStorage.getItem("hive-vps-target")).toBe("deploy@vps.example.com");
    });
    expect(screen.getByText(/ssh -L 7000:localhost:7000 deploy@vps\.example\.com/)).toBeInTheDocument();
  });

  it("uses default HTTPS port in ssh command when local address omits explicit port", async () => {
    const user = userEvent.setup();
    localStorage.setItem("hive-vps-target", "deploy@vps.example.com");
    render(<SettingsView />);

    const localAddressInput = screen.getByPlaceholderText("http://localhost:3000");
    await user.clear(localAddressInput);
    await user.type(localAddressInput, "https://api.example.com");

    expect(screen.getByText(/ssh -L 443:localhost:443 deploy@vps\.example\.com/)).toBeInTheDocument();
  });
});
