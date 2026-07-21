import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConnectionSettings from "@/pages/settings/ConnectionSettings";
import AppearanceSettings from "@/pages/settings/AppearanceSettings";
import { getConnection, replaceConnection } from "@/hooks/useConnection";

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
    vi.restoreAllMocks();
    localStorage.clear();
    check = vi.fn().mockResolvedValue(undefined);
    mocks.useConnectionStatus.mockReset();
    mocks.useConnectionStatus.mockReturnValue({ status: "unknown", check });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/projects")) {
        return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(
        JSON.stringify({
          detected: {
            gh: { installed: true, authenticated: true },
            claude: { installed: true, authenticated: true },
            codex: { installed: true, authenticated: true },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
  });

  it("offers setup and manual connect when not configured", () => {
    render(<ConnectionSettings />);

    expect(screen.getByRole("heading", { name: "Connection" }).closest("div")).toHaveAttribute("data-tauri-drag-region");
    expect(screen.getByText("Connect your server")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("100.x.x.x")).toHaveValue("");
    expect(screen.getByPlaceholderText("3000")).toHaveValue("3000");
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
  });

  it("verifies and stores a manual connection atomically", async () => {
    const user = userEvent.setup();
    const onRefreshConnection = vi.fn();
    render(<ConnectionSettings onRefreshConnection={onRefreshConnection} />);

    await user.type(screen.getByPlaceholderText("100.x.x.x"), " 100.64.0.10 ");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(getConnection()).toMatchObject({ host: "100.64.0.10", port: 3000 });
    await waitFor(() => {
      expect(onRefreshConnection).toHaveBeenCalledTimes(1);
    });
  });

  it("shows the connected server with its address and status", async () => {
    replaceConnection({ host: "100.64.0.10", port: 3000 });
    mocks.useConnectionStatus.mockReturnValue({ status: "connected", check });

    render(<ConnectionSettings />);

    expect(screen.getByText("100.64.0.10:3000")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /test connection/i })).toHaveClass("text-muted-foreground");
    expect(screen.getByRole("button", { name: /disconnect/i })).toHaveClass("hover:text-destructive");
    expect(await screen.findByText("GitHub connected")).toBeInTheDocument();
  });

  it("runs a visible connection check", async () => {
    replaceConnection({ host: "100.64.0.10", port: 3000 });
    let finishCheck: (() => void) | undefined;
    check.mockImplementation(() => new Promise<void>((resolve) => {
      finishCheck = resolve;
    }));
    const user = userEvent.setup();

    render(<ConnectionSettings />);
    const button = screen.getByRole("button", { name: /test connection/i });
    await user.click(button);

    expect(check).toHaveBeenCalledOnce();
    expect(button).toBeDisabled();
    expect(button.querySelector("svg")).toHaveClass("animate-spin");

    finishCheck?.();
    await waitFor(() => expect(button).toBeEnabled());
  });

  it("disconnect clears the stored connection and returns to the connect view", async () => {
    replaceConnection({ host: "100.64.0.10", port: 3000, sshUser: "root", authToken: "tok" });
    const user = userEvent.setup();

    render(<ConnectionSettings />);
    await user.click(screen.getByRole("button", { name: /disconnect/i }));
    await user.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(getConnection()).toBeNull());
    expect(screen.getByText("Connect your server")).toBeInTheDocument();
  });

  it("keeps the connection when the disconnect confirm is declined", async () => {
    replaceConnection({ host: "100.64.0.10", port: 3000 });
    const user = userEvent.setup();

    render(<ConnectionSettings />);
    await user.click(screen.getByRole("button", { name: /disconnect/i }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(getConnection()?.host).toBe("100.64.0.10");
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
