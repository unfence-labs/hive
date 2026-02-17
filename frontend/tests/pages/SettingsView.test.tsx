import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConnectionSettings from "@/pages/settings/ConnectionSettings";
import AppearanceSettings from "@/pages/settings/AppearanceSettings";

const mocks = vi.hoisted(() => ({
  setAccent: vi.fn(),
  useConnectionStatus: vi.fn(),
  useAccentColor: vi.fn(),
}));

vi.mock("@/hooks/useConnectionStatus", () => ({
  useConnectionStatus: mocks.useConnectionStatus,
}));

vi.mock("@/hooks/useAccentColor", () => ({
  useAccentColor: mocks.useAccentColor,
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
  });

  it("shows tailscale placeholders and unknown status when not configured", () => {
    render(<ConnectionSettings />);

    expect(screen.getByRole("heading", { name: "Connection" }).closest("div")).toHaveAttribute("data-tauri-drag-region");
    expect(screen.getByPlaceholderText("100.x.x.x")).toHaveValue("");
    expect(screen.getByPlaceholderText("3000")).toHaveValue("");
    expect(screen.getByText("Not configured")).toBeInTheDocument();
  });

  it("persists tailscale IP on blur and schedules a status check", async () => {
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const user = userEvent.setup();
    render(<ConnectionSettings />);

    const ipInput = screen.getByPlaceholderText("100.x.x.x");
    await user.type(ipInput, " 100.64.0.10 ");
    await user.tab();

    expect(localStorage.getItem("hive-tailscale-ip")).toBe("100.64.0.10");
    expect(localStorage.getItem("hive-server-url")).toBeNull();
    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 300);
  });

  it("persists port on Enter and updates computed server URL", async () => {
    localStorage.setItem("hive-tailscale-ip", "100.64.0.10");
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const user = userEvent.setup();
    render(<ConnectionSettings />);

    const portInput = screen.getByPlaceholderText("3000");
    await user.type(portInput, "3001{Enter}");

    expect(localStorage.getItem("hive-tailscale-port")).toBe("3001");
    expect(localStorage.getItem("hive-server-url")).toBe("http://100.64.0.10:3001");
    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 300);
  });

  it("auto-refreshes connection on blur by running check and parent refresh", async () => {
    const user = userEvent.setup();
    const onRefreshConnection = vi.fn();
    localStorage.setItem("hive-tailscale-port", "3000");

    render(<ConnectionSettings onRefreshConnection={onRefreshConnection} />);

    await user.type(screen.getByPlaceholderText("100.x.x.x"), "100.64.0.11");
    await user.tab();

    await waitFor(() => {
      expect(check).toHaveBeenCalledTimes(1);
      expect(onRefreshConnection).toHaveBeenCalledTimes(1);
    });

    expect(localStorage.getItem("hive-tailscale-ip")).toBe("100.64.0.11");
    expect(localStorage.getItem("hive-tailscale-port")).toBe("3000");
    expect(localStorage.getItem("hive-server-url")).toBe("http://100.64.0.11:3000");
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
  });

  it("updates accent color from accent option buttons", async () => {
    const user = userEvent.setup();
    render(<AppearanceSettings />);

    expect(screen.getByRole("heading", { name: "Appearance" }).closest("div")).toHaveAttribute("data-tauri-drag-region");
    await user.click(screen.getByRole("button", { name: "Accent color: Emerald" }));

    expect(mocks.setAccent).toHaveBeenCalledWith("emerald");
  });
});
