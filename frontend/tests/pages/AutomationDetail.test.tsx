import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import AutomationDetail from "@/pages/AutomationDetail";
import type { Automation, AutomationRun } from "@/types";

const mocks = vi.hoisted(() => ({
  useAutomation: vi.fn(),
  useAutomationRuns: vi.fn(),
  useUpdateAutomation: vi.fn(),
  useDeleteAutomation: vi.fn(),
  useTriggerAutomation: vi.fn(),
  usePromptTemplates: vi.fn(),
  useProjects: vi.fn(),
  getNextRun: vi.fn(),
  formatTimeUntil: vi.fn(),
}));

vi.mock("@/hooks/useAutomations", () => ({
  useAutomation: mocks.useAutomation,
  useAutomationRuns: mocks.useAutomationRuns,
  useUpdateAutomation: mocks.useUpdateAutomation,
  useDeleteAutomation: mocks.useDeleteAutomation,
  useTriggerAutomation: mocks.useTriggerAutomation,
}));

vi.mock("@/hooks/usePromptTemplates", () => ({
  usePromptTemplates: mocks.usePromptTemplates,
}));

vi.mock("@/hooks/useProjects", () => ({
  useProjects: mocks.useProjects,
}));

vi.mock("@/lib/cron", () => ({
  getNextRun: mocks.getNextRun,
  formatTimeUntil: mocks.formatTimeUntil,
}));

vi.mock("@/components/AppLayout", () => ({
  SettingsHeader: ({ children }: { children: ReactNode }) => (
    <div data-testid="settings-header">{children}</div>
  ),
}));

vi.mock("@/components/CreateAutomationDialog", () => ({
  default: ({ open, automation }: { open: boolean; automation?: Automation }) => (
    <div data-testid="edit-dialog">{open ? `open:${automation?.id}` : "closed"}</div>
  ),
}));

vi.mock("@/components/AutomationRunLogSheet", () => ({
  default: ({ run }: { run: AutomationRun | null }) => (
    <div data-testid="run-log-sheet">{run ? run.id : "none"}</div>
  ),
}));

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: "auto-1",
    name: "Nightly audit",
    enabled: true,
    trigger: { type: "cron", expression: "0 2 * * *" },
    action: {
      type: "agent",
      modelId: "claude:opus-4-6",
      userPromptInline: "Review changes",
    },
    notification: { onComplete: true, onFailure: true },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeRun(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: "run-1",
    automationId: "auto-1",
    status: "success",
    sessionId: "sess-1",
    startedAt: "2026-01-01T00:00:00Z",
    completedAt: "2026-01-01T00:01:00Z",
    durationMs: 60_000,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/automations/auto-1"]}>
      <Routes>
        <Route path="/automations/:automationId" element={<AutomationDetail />} />
        <Route path="/automations" element={<div>Automation list</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AutomationDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.usePromptTemplates.mockReturnValue({ data: [] });
    mocks.useProjects.mockReturnValue({ projects: [] });
    mocks.useUpdateAutomation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mocks.useDeleteAutomation.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    mocks.useTriggerAutomation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mocks.useAutomation.mockReturnValue({ data: makeAutomation(), isLoading: false });
    mocks.useAutomationRuns.mockReturnValue({
      data: [makeRun(), makeRun({ id: "run-2", status: "running", summary: "In progress" })],
    });
    mocks.getNextRun.mockReturnValue(new Date(Date.now() + 2 * 60 * 60_000));
    mocks.formatTimeUntil.mockReturnValue("in 2h");
  });

  it("shows next run ETA when automation is enabled and not running", () => {
    renderPage();

    expect(screen.getByText("Next Run")).toBeInTheDocument();
    expect(screen.getByText("in 2h")).toBeInTheDocument();
    expect(mocks.getNextRun).toHaveBeenCalledWith("0 2 * * *");
  });

  it("shows 'Running now' when the latest run is active", () => {
    mocks.useAutomation.mockReturnValue({
      data: makeAutomation({ lastRunStatus: "running" }),
      isLoading: false,
    });

    renderPage();

    expect(screen.getByText("Running now")).toBeInTheDocument();
  });

  it("opens run log for completed runs and opens edit dialog", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.getAllByText("Log")).toHaveLength(1);
    expect(screen.getByTestId("run-log-sheet")).toHaveTextContent("none");

    await user.click(screen.getByText("Log"));
    expect(screen.getByTestId("run-log-sheet")).toHaveTextContent("run-1");

    expect(screen.getByTestId("edit-dialog")).toHaveTextContent("closed");
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByTestId("edit-dialog")).toHaveTextContent("open:auto-1");
  });
});
