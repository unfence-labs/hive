import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConnectionSettings from "@/pages/settings/ConnectionSettings";
import AppearanceSettings from "@/pages/settings/AppearanceSettings";

const mocks = vi.hoisted(() => ({
  setAccent: vi.fn(),
  setThemeMode: vi.fn(),
  useConnectionStatus: vi.fn(),
  useAccentColor: vi.fn(),
  useThemeMode: vi.fn(),
}));

vi.mock("@/hooks/useConnectionStatus", () => ({
  useConnectionStatus: mocks.useConnectionStatus,
}));

vi.mock("@/hooks/useAccentColor", () => ({
  useAccentColor: mocks.useAccentColor,
}));

vi.mock("@/hooks/useThemeMode", () => ({
  useThemeMode: mocks.useThemeMode,
  THEME_MODES: ["system", "light", "dark"],
}));

describe("ConnectionSettings", () => {
  let check: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    check = vi.fn().mockResolvedValue(undefined);
    mocks.useConnectionStatus.mockReset();
    mocks.useConnectionStatus.mockReturnValue({ status: "unknown", check });

    vi.restoreAllMocks();
    localStorage.removeItem("hive-server-url");
    localStorage.removeItem("hive-tailscale-ip");
    localStorage.removeItem("hive-tailscale-port");
    localStorage.removeItem("hive-ssh-user");
    localStorage.removeItem("hive-auth-token");
    localStorage.removeItem("hive-ssh-connection");
  });

  it("offers setup and manual connect when not configured", () => {
    render(<ConnectionSettings />);

    expect(screen.getByRole("heading", { name: "Connection" }).closest("div")).toHaveAttribute("data-tauri-drag-region");
    expect(screen.getByText("Connect your server")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("100.x.x.x")).toHaveValue("");
    expect(screen.getByPlaceholderText("3000")).toHaveValue("3000");
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
  });

  it("connects manually: persists IP/port, computes the server URL, checks", async () => {
    const user = userEvent.setup();
    const onRefreshConnection = vi.fn();
    render(<ConnectionSettings onRefreshConnection={onRefreshConnection} />);

    await user.type(screen.getByPlaceholderText("100.x.x.x"), " 100.64.0.10 ");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(localStorage.getItem("hive-tailscale-ip")).toBe("100.64.0.10");
    expect(localStorage.getItem("hive-tailscale-port")).toBe("3000");
    expect(localStorage.getItem("hive-server-url")).toBe("http://100.64.0.10:3000");
    await waitFor(() => {
      expect(check).toHaveBeenCalledTimes(1);
      expect(onRefreshConnection).toHaveBeenCalledTimes(1);
    });
  });

  it("shows the connected server with its address and status", () => {
    localStorage.setItem("hive-tailscale-ip", "100.64.0.10");
    localStorage.setItem("hive-tailscale-port", "3000");
    mocks.useConnectionStatus.mockReturnValue({ status: "connected", check });

    render(<ConnectionSettings />);

    expect(screen.getByText("100.64.0.10:3000")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /test connection/i })).toBeInTheDocument();
  });

  it("disconnect clears the stored connection and returns to the connect view", async () => {
    localStorage.setItem("hive-tailscale-ip", "100.64.0.10");
    localStorage.setItem("hive-tailscale-port", "3000");
    localStorage.setItem("hive-server-url", "http://100.64.0.10:3000");
    localStorage.setItem("hive-ssh-user", "root");
    localStorage.setItem("hive-auth-token", "tok");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();

    render(<ConnectionSettings />);
    await user.click(screen.getByRole("button", { name: /disconnect/i }));

    expect(localStorage.getItem("hive-tailscale-ip")).toBeNull();
    expect(localStorage.getItem("hive-tailscale-port")).toBeNull();
    expect(localStorage.getItem("hive-server-url")).toBeNull();
    expect(localStorage.getItem("hive-ssh-user")).toBeNull();
    expect(localStorage.getItem("hive-auth-token")).toBeNull();
    expect(screen.getByText("Connect your server")).toBeInTheDocument();
  });

  it("keeps the connection when the disconnect confirm is declined", async () => {
    localStorage.setItem("hive-tailscale-ip", "100.64.0.10");
    localStorage.setItem("hive-tailscale-port", "3000");
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();

    render(<ConnectionSettings />);
    await user.click(screen.getByRole("button", { name: /disconnect/i }));

    expect(localStorage.getItem("hive-tailscale-ip")).toBe("100.64.0.10");
    expect(screen.getByText("100.64.0.10:3000")).toBeInTheDocument();
  });
});

describe("AppearanceSettings", () => {
  beforeEach(() => {
    mocks.setAccent.mockReset();
    mocks.useAccentColor.mockReset();
    mocks.useAccentColor.mockReturnValue({
      accentId: "blue",
      setAccent: mocks.setAccent,
      options: [
        { id: "blue", label: "Blue", color: "#3b82f6" },
        { id: "emerald", label: "Emerald", color: "#10b981" },
      ],
    });

    mocks.setThemeMode.mockReset();
    mocks.useThemeMode.mockReset();
    mocks.useThemeMode.mockReturnValue({
      mode: "system",
      setMode: mocks.setThemeMode,
      options: ["system", "light", "dark"],
    });
  });

  it("updates accent color from accent option buttons", async () => {
    const user = userEvent.setup();
    render(<AppearanceSettings />);

    expect(screen.getByRole("heading", { name: "Appearance" }).closest("div")).toHaveAttribute("data-tauri-drag-region");
    await user.click(screen.getByRole("button", { name: "Accent color: Emerald" }));

    expect(mocks.setAccent).toHaveBeenCalledWith("emerald");
  });

  it("switches theme mode when selecting an option", async () => {
    const user = userEvent.setup();
    render(<AppearanceSettings />);

    await user.click(screen.getByRole("radio", { name: "Light" }));
    expect(mocks.setThemeMode).toHaveBeenCalledWith("light");

    await user.click(screen.getByRole("radio", { name: "Dark" }));
    expect(mocks.setThemeMode).toHaveBeenCalledWith("dark");
  });

  it("marks the active theme mode as checked", () => {
    mocks.useThemeMode.mockReturnValue({
      mode: "dark",
      setMode: mocks.setThemeMode,
      options: ["system", "light", "dark"],
    });
    render(<AppearanceSettings />);

    expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Light" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: "System" })).toHaveAttribute("aria-checked", "false");
  });
});
