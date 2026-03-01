import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import NotificationSettings from "@/pages/settings/NotificationSettings";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
}));

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: mocks.get,
    put: mocks.put,
    post: mocks.post,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  localStorage.removeItem("hive:local-toasts-enabled");
});

const defaultApns = {
  enabled: false, teamId: "", keyId: "", keyContent: "", bundleId: "", sandbox: false, deviceTokens: [] as string[],
};

async function renderReady(config?: {
  enabled?: boolean;
  botToken?: string;
  chatId?: string;
}) {
  const response = {
    telegram: {
      enabled: config?.enabled ?? false,
      botToken: config?.botToken ?? "",
      chatId: config?.chatId ?? "",
    },
    apns: { ...defaultApns },
  };
  mocks.get.mockResolvedValue(response);
  mocks.get.mockResolvedValueOnce(response);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <NotificationSettings />
    </QueryClientProvider>,
  );

  await screen.findByRole("heading", { name: "Notifications" });
}

/** Return the Telegram `<section>` element for scoped queries. */
function telegramSection() {
  const heading = screen.getByRole("heading", { name: "Telegram" });
  return within(heading.closest("section")!);
}

describe("NotificationSettings", () => {
  it("defaults local in-app toasts toggle to enabled when unset", async () => {
    await renderReady();

    expect(screen.getByRole("switch", { name: "In-App Toasts" })).toHaveAttribute("aria-checked", "true");
  });

  it("reads and persists local in-app toasts toggle state in localStorage", async () => {
    const user = userEvent.setup();
    localStorage.setItem("hive:local-toasts-enabled", "false");

    await renderReady();

    const toggle = screen.getByRole("switch", { name: "In-App Toasts" });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(localStorage.getItem("hive:local-toasts-enabled")).toBe("true");
  });

  it("loads and displays Telegram settings from backend", async () => {
    await renderReady({ enabled: true, botToken: "token-1", chatId: "chat-1" });

    expect(mocks.get).toHaveBeenCalledWith("/api/settings/notifications");
    expect(screen.getByRole("heading", { name: "Notifications" }).closest("div")).toHaveAttribute("data-tauri-drag-region");
    expect(screen.getByRole("switch", { name: "Telegram" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Bot Token")).toHaveValue("token-1");
    expect(screen.getByLabelText("Chat ID")).toHaveValue("chat-1");
    expect(telegramSection().getByRole("button", { name: "Test" })).toBeEnabled();
  });

  it("falls back to default values when initial load fails", async () => {
    mocks.get.mockRejectedValueOnce(new Error("offline"));

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <NotificationSettings />
      </QueryClientProvider>,
    );

    await screen.findByRole("heading", { name: "Notifications" });

    expect(screen.getByRole("switch", { name: "Telegram" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByLabelText("Bot Token")).toHaveValue("");
    expect(screen.getByLabelText("Chat ID")).toHaveValue("");
    expect(telegramSection().getByRole("button", { name: "Test" })).toBeDisabled();
  });

  it("toggles token visibility", async () => {
    const user = userEvent.setup();
    await renderReady({ botToken: "secret-token" });

    const tokenInput = screen.getByLabelText("Bot Token") as HTMLInputElement;
    expect(tokenInput.type).toBe("password");

    const visibilityButton = tokenInput.parentElement?.querySelector("button");
    expect(visibilityButton).toBeTruthy();

    await user.click(visibilityButton!);

    expect(tokenInput.type).toBe("text");
  });

  it("keeps Test button disabled until both credentials are non-empty after trim", async () => {
    const user = userEvent.setup();
    await renderReady({ enabled: true });

    const tg = telegramSection();
    const testButton = tg.getByRole("button", { name: "Test" });
    expect(testButton).toBeDisabled();

    await user.type(screen.getByLabelText("Bot Token"), "   ");
    await user.type(screen.getByLabelText("Chat ID"), "   ");
    expect(testButton).toBeDisabled();

    await user.clear(screen.getByLabelText("Bot Token"));
    await user.type(screen.getByLabelText("Bot Token"), "token");
    expect(testButton).toBeDisabled();

    await user.clear(screen.getByLabelText("Chat ID"));
    await user.type(screen.getByLabelText("Chat ID"), "chat-id");
    expect(testButton).toBeEnabled();
  });

  it("saves settings and shows success feedback", async () => {
    const user = userEvent.setup();
    mocks.put.mockResolvedValueOnce({ ok: true });

    await renderReady();

    await user.click(screen.getByRole("switch", { name: "Telegram" }));
    await user.type(screen.getByLabelText("Bot Token"), "token-abc");
    await user.type(screen.getByLabelText("Chat ID"), "-100123");
    await user.click(telegramSection().getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mocks.put).toHaveBeenCalledWith("/api/settings/notifications", {
        telegram: {
          enabled: true,
          botToken: "token-abc",
          chatId: "-100123",
        },
      });
    });
    expect(telegramSection().getByText("Saved")).toBeInTheDocument();
  });

  it("shows save error and clears feedback on input change", async () => {
    const user = userEvent.setup();
    mocks.put.mockRejectedValueOnce(new Error("boom"));

    await renderReady({ enabled: true, botToken: "token", chatId: "chat" });

    await user.click(telegramSection().getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Failed to save")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Chat ID"), "1");
    expect(screen.queryByText("Failed to save")).not.toBeInTheDocument();
  });

  it("sends test notification and shows success feedback", async () => {
    const user = userEvent.setup();
    mocks.post.mockResolvedValueOnce({ ok: true });

    await renderReady({ enabled: true, botToken: "token", chatId: "chat" });

    await user.click(telegramSection().getByRole("button", { name: "Test" }));

    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledWith("/api/settings/notifications/test", {
        botToken: "token",
        chatId: "chat",
      });
    });
    expect(screen.getByText("Test message sent!")).toBeInTheDocument();
  });

  it("shows backend test error returned by API", async () => {
    const user = userEvent.setup();
    mocks.post.mockResolvedValueOnce({ ok: false, error: "chat not found" });

    await renderReady({ enabled: true, botToken: "token", chatId: "chat" });

    await user.click(telegramSection().getByRole("button", { name: "Test" }));

    expect(await screen.findByText("chat not found")).toBeInTheDocument();
  });

  it("shows network error when test request fails", async () => {
    const user = userEvent.setup();
    mocks.post.mockRejectedValueOnce(new Error("network"));

    await renderReady({ enabled: true, botToken: "token", chatId: "chat" });

    await user.click(telegramSection().getByRole("button", { name: "Test" }));

    expect(await screen.findByText("Could not reach backend")).toBeInTheDocument();
  });
});
