import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AgentSettings from "@/pages/settings/AgentSettings";

/**
 * The page is a Settings frame around {@link ToolsPanel}; the panel's own
 * behaviour is covered in tests/components/ToolsPanel.test.tsx. What is worth
 * pinning here is that the frame exists and that the panel is genuinely
 * mounted inside it, reading the tools API.
 */
const mocks = vi.hoisted(() => ({
  getTools: vi.fn(),
  startOperation: vi.fn(),
  startAuth: vi.fn(),
  submitAuthCode: vi.fn(),
  cancelAuth: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock("@/hooks/useApi", () => ({ api: { post: mocks.apiPost } }));

vi.mock("@/lib/setup-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/setup-api")>()),
  createSetupApi: () => ({
    getTools: mocks.getTools,
    startOperation: mocks.startOperation,
    startAuth: mocks.startAuth,
    submitAuthCode: mocks.submitAuthCode,
    cancelAuth: mocks.cancelAuth,
  }),
}));

vi.mock("@/components/AppLayout", () => ({
  SettingsHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-tauri-drag-region>{children}</div>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getTools.mockResolvedValue({ tools: [], operations: [], authSessions: [] });
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
    renderPage();
    const heading = await screen.findByRole("heading", { name: "Harness" });
    expect(heading.closest("div")).toHaveAttribute("data-tauri-drag-region");
  });

  it("hosts the tools panel, which reads its own state", async () => {
    mocks.getTools.mockResolvedValue({
      tools: [
        {
          id: "claude",
          label: "Claude Code",
          installed: true,
          version: "1.0.35",
          latestVersion: "1.0.35",
          updateAvailable: false,
          authenticated: true,
          managed: true,
        },
      ],
      operations: [],
      authSessions: [],
    });

    renderPage();

    expect(await screen.findByRole("heading", { name: "Claude Code" })).toBeInTheDocument();
    expect(screen.getByText("v1.0.35")).toBeInTheDocument();
    expect(mocks.getTools).toHaveBeenCalled();
  });

  it("states where installs land, since it is not the system prefix", async () => {
    renderPage();
    expect(
      await screen.findByText(/service account's own directory, never system-wide/),
    ).toBeInTheDocument();
  });
});
