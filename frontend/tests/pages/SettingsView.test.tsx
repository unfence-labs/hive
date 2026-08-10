import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConnectionSettings from "@/pages/settings/ConnectionSettings";
import ServerSettings from "@/pages/settings/ServerSettings";
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

const TRANSPORT_SECURITY_WARNING =
  "HTTPS is not supported yet. Connect through an encrypted private network such as Tailscale, WireGuard, or another VPN. Never use a public address.";

function expectTransportSecurityWarning() {
  const warning = screen.getByText(TRANSPORT_SECURITY_WARNING).closest('[role="alert"]');
  expect(warning).toHaveTextContent("Private network required");
}

describe("ConnectionSettings", () => {
  let check: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    check = vi.fn().mockResolvedValue(undefined);
    mocks.useConnectionStatus.mockReset();
    mocks.useConnectionStatus.mockReturnValue({ status: "unknown", check });
  });

  function mockProbe(response: Response | Error) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
    );
  }

  it("shows empty host, token and default port when no server is configured", () => {
    render(<ConnectionSettings />);

    expect(screen.getByRole("heading", { name: "Connection" }).closest("div")).toHaveAttribute("data-tauri-drag-region");
    expect(screen.getByPlaceholderText("203.0.113.10")).toHaveValue("");
    expect(screen.getByPlaceholderText("9420")).toHaveValue("9420");
    expect(screen.getByPlaceholderText("Paste the access token")).toHaveValue("");
    expect(screen.getByText("Not configured")).toBeInTheDocument();
    expectTransportSecurityWarning();
  });

  it("prefills host, port and SSH user from the stored record, but never the token", () => {
    replaceConnection({
      host: "100.64.0.10",
      port: 3001,
      authToken: "stored-token",
      sshUser: "hive",
      adminUser: "root",
    });
    mocks.useConnectionStatus.mockReturnValue({ status: "connected", check });

    render(<ConnectionSettings />);

    expect(screen.getByPlaceholderText("203.0.113.10")).toHaveValue("100.64.0.10");
    expect(screen.getByPlaceholderText("9420")).toHaveValue("3001");
    // The stored token is write-only: the field stays empty and a notice says
    // one is stored, rather than the value ever being shown back.
    expect(screen.getByPlaceholderText("Paste the access token")).toHaveValue("");
    expect(screen.getByText(/an access token is stored/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("hive")).toHaveValue("hive");
    expect(screen.getByText("root")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expectTransportSecurityWarning();
  });

  it("shows the token-rejected badge distinctly from an unreachable server", () => {
    replaceConnection({ host: "100.64.0.10", port: 3000, authToken: "stale" });
    mocks.useConnectionStatus.mockReturnValue({ status: "unauthorized", check });

    const { unmount } = render(<ConnectionSettings />);

    expect(screen.getByText("Token rejected")).toBeInTheDocument();
    expect(screen.queryByText("Unreachable")).not.toBeInTheDocument();
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("rejected this access token");
    unmount();

    mocks.useConnectionStatus.mockReturnValue({ status: "disconnected", check });
    render(<ConnectionSettings />);

    expect(screen.getByText("Unreachable")).toBeInTheDocument();
    expect(screen.queryByText("Token rejected")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("did not answer");
  });

  it("verifies reachability with the typed token before storing the record", async () => {
    const fetchMock = mockProbe(new Response("[]", { status: 200 }));
    const user = userEvent.setup();
    const onRefreshConnection = vi.fn();
    render(<ConnectionSettings onRefreshConnection={onRefreshConnection} />);

    await user.type(screen.getByPlaceholderText("203.0.113.10"), " 100.64.0.10 ");
    await user.type(screen.getByPlaceholderText("Paste the access token"), "tok");
    await user.type(screen.getByPlaceholderText("hive"), "hive");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(onRefreshConnection).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "http://100.64.0.10:9420/api/projects",
      expect.objectContaining({ headers: { Authorization: "Bearer tok" } }),
    );
    expect(getConnection()).toMatchObject({
      host: "100.64.0.10",
      port: 9420,
      authToken: "tok",
      sshUser: "hive",
    });
  });

  it("reports an unreachable server and stores nothing", async () => {
    mockProbe(new TypeError("Failed to fetch"));
    const user = userEvent.setup();
    render(<ConnectionSettings />);

    await user.type(screen.getByPlaceholderText("203.0.113.10"), "100.64.0.10");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByText("The server could not be reached.")).toBeInTheDocument();
    expect(getConnection()).toBeNull();
  });

  it("reports a rejected token distinctly from an unreachable server", async () => {
    mockProbe(new Response("", { status: 401 }));
    const user = userEvent.setup();
    render(<ConnectionSettings />);

    await user.type(screen.getByPlaceholderText("203.0.113.10"), "100.64.0.10");
    await user.type(screen.getByPlaceholderText("Paste the access token"), "wrong");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByText("The server rejected the access token.")).toBeInTheDocument();
    expect(getConnection()).toBeNull();
  });

  it("keeps the stored token when reconnecting with the field left blank", async () => {
    replaceConnection({
      host: "100.64.0.10",
      port: 3000,
      authToken: "good",
      sshKeyPath: "/home/lenny/.ssh/id_ed25519",
    });
    const fetchMock = mockProbe(new Response("[]", { status: 200 }));
    const user = userEvent.setup();
    render(<ConnectionSettings />);

    await user.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() =>
      expect(getConnection()).toMatchObject({
        host: "100.64.0.10",
        authToken: "good",
        // Install-owned like adminUser: a reconnect must not drop the key
        // path the in-app server update depends on.
        sshKeyPath: "/home/lenny/.ssh/id_ed25519",
      }),
    );
    // The probe authenticated with the stored token, not with an empty one.
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: { Authorization: "Bearer good" } }),
    );
  });

  it("drops the install-owned identity when pointing at a different host", async () => {
    replaceConnection({
      host: "100.64.0.10",
      port: 3000,
      authToken: "good",
      adminUser: "ops",
      sshKeyPath: "/home/lenny/.ssh/id_ed25519",
    });
    mockProbe(new Response("[]", { status: 200 }));
    const user = userEvent.setup();
    render(<ConnectionSettings />);

    const host = screen.getByPlaceholderText("203.0.113.10");
    await user.clear(host);
    await user.type(host, "100.64.0.20");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(getConnection()?.host).toBe("100.64.0.20"));
    // The key and admin login describe the old server, not the new one.
    expect(getConnection()?.sshKeyPath).toBeUndefined();
    expect(getConnection()?.adminUser).toBeUndefined();
  });

  it("keeps the working connection when a new attempt is rejected", async () => {
    replaceConnection({ host: "old.example.com", port: 3000, authToken: "good" });
    mockProbe(new Response("", { status: 401 }));
    const user = userEvent.setup();
    render(<ConnectionSettings />);

    const host = screen.getByPlaceholderText("203.0.113.10");
    await user.clear(host);
    await user.type(host, "new.example.com");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    await screen.findByText("The server rejected the access token.");
    expect(getConnection()).toMatchObject({ host: "old.example.com", authToken: "good" });
  });

  it("preserves the install-owned admin login across a manual reconnect", async () => {
    replaceConnection({ host: "100.64.0.10", port: 3000, adminUser: "root" });
    mockProbe(new Response("[]", { status: 200 }));
    const user = userEvent.setup();
    render(<ConnectionSettings />);

    await user.type(screen.getByPlaceholderText("hive"), "hive");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(getConnection()).toMatchObject({ sshUser: "hive", adminUser: "root" }));
  });

  it("disables Connect until the host and port are usable", async () => {
    const user = userEvent.setup();
    render(<ConnectionSettings />);

    const connect = screen.getByRole("button", { name: "Connect" });
    expect(connect).toBeDisabled();

    await user.type(screen.getByPlaceholderText("203.0.113.10"), "100.64.0.10");
    expect(connect).toBeEnabled();

    const port = screen.getByPlaceholderText("9420");
    await user.clear(port);
    await user.type(port, "99999");
    expect(connect).toBeDisabled();
  });

  it("runs a visible connection check when a server is configured", async () => {
    replaceConnection({ host: "100.64.0.10", port: 3000 });
    let finishCheck: (() => void) | undefined;
    check.mockImplementation(() => new Promise<void>((resolve) => { finishCheck = resolve; }));
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

  it("re-seeds the form from the record written underneath it", async () => {
    mockProbe(new Response("[]", { status: 200 }));
    const user = userEvent.setup();
    render(<ConnectionSettings />);

    const host = screen.getByPlaceholderText("203.0.113.10");
    await user.type(host, " 100.64.0.10 ");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    // The stored host is trimmed; the form must show what was actually stored.
    await waitFor(() => expect(host).toHaveValue("100.64.0.10"));

    act(() =>
      replaceConnection({ host: "installed.example.com", port: 4000, authToken: "issued" }),
    );
    expect(host).toHaveValue("installed.example.com");
    expect(screen.getByPlaceholderText("9420")).toHaveValue("4000");
    // The token written underneath is stored, never displayed.
    expect(screen.getByPlaceholderText("Paste the access token")).toHaveValue("");
    expect(screen.getByText(/an access token is stored/i)).toBeInTheDocument();
  });

  it("hides the connection check until a server is configured", () => {
    render(<ConnectionSettings />);
    expect(screen.queryByRole("button", { name: /test connection/i })).not.toBeInTheDocument();
  });

  it("states the configured address only in the form", () => {
    replaceConnection({ host: "100.64.0.10", port: 9420, authToken: "issued", sshUser: "hive" });
    render(<ConnectionSettings />);

    // The form already shows host and port; the card header does not repeat them.
    expect(screen.queryByText("100.64.0.10:9420")).not.toBeInTheDocument();
    expect(screen.queryByText(/enter the address/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /test connection/i })).toBeInTheDocument();
  });

  it("offers nothing that puts the app back into an unconfigured state", () => {
    replaceConnection({ host: "100.64.0.10", port: 9420, authToken: "issued" });
    render(<ConnectionSettings />);

    for (const label of [/disconnect/i, /forget/i, /remove/i, /sign out/i, /reset/i]) {
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    }
    expect(getConnection()).not.toBeNull();
  });
});

describe("ServerSettings", () => {
  it("relaunches the installer on demand", async () => {
    const user = userEvent.setup();
    const onOpenInstaller = vi.fn();
    render(<ServerSettings onOpenInstaller={onOpenInstaller} />);

    await user.click(screen.getByRole("button", { name: "Open the installer" }));

    expect(onOpenInstaller).toHaveBeenCalledTimes(1);
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
