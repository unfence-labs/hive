import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AgentSettings from "@/pages/settings/AgentSettings";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("@/hooks/useApi", () => ({
  api: { get: mocks.get },
}));

vi.mock("@/components/AppLayout", () => ({
  SettingsHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-tauri-drag-region>{children}</div>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AgentSettings />
    </QueryClientProvider>,
  );
}

describe("AgentSettings", () => {
  it("renders heading with drag region", async () => {
    mocks.get.mockResolvedValueOnce({ agents: [] });
    renderPage();
    const heading = await screen.findByRole("heading", { name: "CLI" });
    expect(heading.closest("div")).toHaveAttribute("data-tauri-drag-region");
  });

  it("shows loading state", () => {
    mocks.get.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/Checking agent versions/)).toBeInTheDocument();
  });

  it("requests agent settings from the expected API endpoint", async () => {
    mocks.get.mockResolvedValueOnce({ agents: [] });
    renderPage();

    await screen.findByRole("heading", { name: "CLI" });
    expect(mocks.get).toHaveBeenCalledWith("/api/settings/cli");
  });

  it("renders installed agent with 'Up to date' badge", async () => {
    mocks.get.mockResolvedValueOnce({
      agents: [
        { id: "claude", label: "Claude Code", installed: true, version: "1.0.35", latestVersion: "1.0.35", updateAvailable: false },
      ],
    });
    renderPage();
    expect(await screen.findByText("Claude Code")).toBeInTheDocument();
    expect(screen.getByText("v1.0.35")).toBeInTheDocument();
    expect(screen.getByText("Up to date")).toBeInTheDocument();
  });

  it("renders 'Update available' badge when newer version exists", async () => {
    mocks.get.mockResolvedValueOnce({
      agents: [
        { id: "codex", label: "Codex", installed: true, version: "0.1.2", latestVersion: "0.2.0", updateAvailable: true },
      ],
    });
    renderPage();
    expect(await screen.findByText(/Update available/)).toBeInTheDocument();
    expect(screen.getByText(/0\.2\.0/)).toBeInTheDocument();
  });

  it("renders 'Not installed' badge for missing agents", async () => {
    mocks.get.mockResolvedValueOnce({
      agents: [
        { id: "codex", label: "Codex", installed: false, version: null, latestVersion: null, updateAvailable: false },
      ],
    });
    renderPage();
    expect(await screen.findByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("Not installed")).toBeInTheDocument();
  });

  it("renders neutral 'Installed' badge when registry is unreachable", async () => {
    mocks.get.mockResolvedValueOnce({
      agents: [
        { id: "claude", label: "Claude Code", installed: true, version: "1.0.35", latestVersion: null, updateAvailable: false },
      ],
    });
    renderPage();
    expect(await screen.findByText("Installed")).toBeInTheDocument();
  });

  it("hides version text for installed agents when version is null", async () => {
    mocks.get.mockResolvedValueOnce({
      agents: [
        { id: "claude", label: "Claude Code", installed: true, version: null, latestVersion: "1.0.35", updateAvailable: false },
      ],
    });
    renderPage();

    await screen.findByText("Claude Code");
    expect(screen.queryByText(/^v/)).not.toBeInTheDocument();
  });

  it("shows error state when API call fails", async () => {
    mocks.get.mockRejectedValueOnce(new Error("offline"));
    renderPage();
    expect(await screen.findByText(/Could not load agent information/)).toBeInTheDocument();
  });

  it("does not show version for non-installed agents", async () => {
    mocks.get.mockResolvedValueOnce({
      agents: [
        { id: "codex", label: "Codex", installed: false, version: null, latestVersion: "0.2.0", updateAvailable: false },
      ],
    });
    renderPage();
    await screen.findByText("Codex");
    expect(screen.queryByText(/^v/)).not.toBeInTheDocument();
  });

  it("renders multiple agents", async () => {
    mocks.get.mockResolvedValueOnce({
      agents: [
        { id: "claude", label: "Claude Code", installed: true, version: "1.0.35", latestVersion: "1.0.35", updateAvailable: false },
        { id: "codex", label: "Codex", installed: true, version: "0.1.2", latestVersion: "0.2.0", updateAvailable: true },
      ],
    });
    renderPage();
    expect(await screen.findByText("Claude Code")).toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
  });
});
