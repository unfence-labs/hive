import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
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
  });

  function mockProbe(response: Response | Error) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
    );
  }

  it("shows empty host, token and default port when no server is configured", () => {
    render(<ConnectionSettings />);

    expect(screen.getByRole("heading", { name: "Connection" }).closest("div")).toHaveAttribute("data-tauri-drag-region");
    expect(screen.getByPlaceholderText("100.x.x.x")).toHaveValue("");
    expect(screen.getByPlaceholderText("3000")).toHaveValue("3000");
    expect(screen.getByPlaceholderText("Paste the access token")).toHaveValue("");
    expect(screen.getByText("Not configured")).toBeInTheDocument();
  });

  it("prefills host, port, token and SSH user from the stored record", () => {
    replaceConnection({
      host: "100.64.0.10",
      port: 3001,
      authToken: "stored-token",
      sshUser: "hive",
      adminUser: "root",
    });
    mocks.useConnectionStatus.mockReturnValue({ status: "connected", check });

    render(<ConnectionSettings />);

    expect(screen.getByPlaceholderText("100.x.x.x")).toHaveValue("100.64.0.10");
    expect(screen.getByPlaceholderText("3000")).toHaveValue("3001");
    expect(screen.getByPlaceholderText("Paste the access token")).toHaveValue("stored-token");
    expect(screen.getByPlaceholderText("hive")).toHaveValue("hive");
    expect(screen.getByText("root")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
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

    await user.type(screen.getByPlaceholderText("100.x.x.x"), " 100.64.0.10 ");
    await user.type(screen.getByPlaceholderText("Paste the access token"), "tok");
    await user.type(screen.getByPlaceholderText("hive"), "hive");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(onRefreshConnection).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "http://100.64.0.10:3000/api/projects",
      expect.objectContaining({ headers: { Authorization: "Bearer tok" } }),
    );
    expect(getConnection()).toMatchObject({
      host: "100.64.0.10",
      port: 3000,
      authToken: "tok",
      sshUser: "hive",
    });
  });

  it("reports an unreachable server and stores nothing", async () => {
    mockProbe(new TypeError("Failed to fetch"));
    const user = userEvent.setup();
    render(<ConnectionSettings />);

    await user.type(screen.getByPlaceholderText("100.x.x.x"), "100.64.0.10");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The server could not be reached.");
    expect(getConnection()).toBeNull();
  });

  it("reports a rejected token distinctly from an unreachable server", async () => {
    mockProbe(new Response("", { status: 401 }));
    const user = userEvent.setup();
    render(<ConnectionSettings />);

    await user.type(screen.getByPlaceholderText("100.x.x.x"), "100.64.0.10");
    await user.type(screen.getByPlaceholderText("Paste the access token"), "wrong");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The server rejected the access token.");
    expect(getConnection()).toBeNull();
  });

  it("keeps the working connection when a new attempt is rejected", async () => {
    replaceConnection({ host: "old.ts.net", port: 3000, authToken: "good" });
    mockProbe(new Response("", { status: 401 }));
    const user = userEvent.setup();
    render(<ConnectionSettings />);

    const host = screen.getByPlaceholderText("100.x.x.x");
    await user.clear(host);
    await user.type(host, "new.ts.net");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    await screen.findByRole("alert");
    expect(getConnection()).toMatchObject({ host: "old.ts.net", authToken: "good" });
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

    await user.type(screen.getByPlaceholderText("100.x.x.x"), "100.64.0.10");
    expect(connect).toBeEnabled();

    const port = screen.getByPlaceholderText("3000");
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

    const host = screen.getByPlaceholderText("100.x.x.x");
    await user.type(host, " 100.64.0.10 ");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    // The stored host is trimmed; the form must show what was actually stored.
    await waitFor(() => expect(host).toHaveValue("100.64.0.10"));

    act(() => replaceConnection({ host: "installed.ts.net", port: 4000, authToken: "issued" }));
    expect(host).toHaveValue("installed.ts.net");
    expect(screen.getByPlaceholderText("3000")).toHaveValue("4000");
    expect(screen.getByPlaceholderText("Paste the access token")).toHaveValue("issued");
  });

  it("hides the connection check until a server is configured", () => {
    render(<ConnectionSettings />);
    expect(screen.queryByRole("button", { name: /test connection/i })).not.toBeInTheDocument();
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
