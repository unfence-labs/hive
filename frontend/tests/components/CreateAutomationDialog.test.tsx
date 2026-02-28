import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CreateAutomationDialog from "@/components/CreateAutomationDialog";
import type { Automation, Project, PromptTemplate } from "@/types";

const mocks = vi.hoisted(() => ({
  useProjects: vi.fn(),
  usePromptTemplates: vi.fn(),
  useCreateAutomation: vi.fn(),
  useUpdateAutomation: vi.fn(),
  apiGet: vi.fn(),
  navigate: vi.fn(),
  createMutateAsync: vi.fn(),
  updateMutateAsync: vi.fn(),
}));

vi.mock("@/hooks/useProjects", () => ({
  useProjects: mocks.useProjects,
}));

vi.mock("@/hooks/usePromptTemplates", () => ({
  usePromptTemplates: mocks.usePromptTemplates,
}));

vi.mock("@/hooks/useAutomations", () => ({
  useCreateAutomation: mocks.useCreateAutomation,
  useUpdateAutomation: mocks.useUpdateAutomation,
}));

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: mocks.apiGet,
  },
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "Alpha",
    url: "https://github.com/acme/alpha.git",
    createdAt: "2026-01-01T00:00:00Z",
    workspaces: [],
    ...overrides,
  };
}

function makeTemplate(overrides: Partial<PromptTemplate> = {}): PromptTemplate {
  return {
    id: "tpl-1",
    name: "Security Prompt",
    type: "system",
    content: "You are a security auditor.",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: "auto-1",
    name: "Nightly audit",
    enabled: true,
    projectId: "proj-1",
    trigger: { type: "cron", expression: "0 2 * * *" },
    action: {
      type: "agent",
      modelId: "claude:opus-4-6",
      systemPromptInline: "Be strict.",
      userPromptInline: "Review the latest commit.",
    },
    notification: { onComplete: true, onFailure: false },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderDialog({
  automation,
  onOpenChange = vi.fn(),
}: {
  automation?: Automation;
  onOpenChange?: (open: boolean) => void;
}) {
  return render(
    <MemoryRouter>
      <CreateAutomationDialog
        open
        onOpenChange={onOpenChange}
        automation={automation}
      />
    </MemoryRouter>,
  );
}

describe("CreateAutomationDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useProjects.mockReturnValue({ projects: [makeProject()] });
    mocks.usePromptTemplates.mockReturnValue({ data: [makeTemplate(), makeTemplate({ id: "tpl-u", type: "user", name: "User Prompt" })] });
    mocks.useCreateAutomation.mockReturnValue({ mutateAsync: mocks.createMutateAsync, isPending: false });
    mocks.useUpdateAutomation.mockReturnValue({ mutateAsync: mocks.updateMutateAsync, isPending: false });
    mocks.apiGet.mockResolvedValue({
      models: [{ id: "claude:opus-4-6", label: "Claude Opus", providerLabel: "Anthropic" }],
      defaultModelId: "claude:opus-4-6",
    });
    mocks.createMutateAsync.mockResolvedValue({ id: "auto-new" });
    mocks.updateMutateAsync.mockResolvedValue(makeAutomation());
  });

  it("prefills fields in edit mode and disables project selection", async () => {
    renderDialog({ automation: makeAutomation() });

    await waitFor(() => {
      expect(mocks.apiGet).toHaveBeenCalledWith("/api/models");
    });

    expect(screen.getByRole("heading", { name: "Edit Automation" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Nightly audit")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Review the latest commit.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Be strict.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeInTheDocument();

    const [projectSelect] = screen.getAllByRole("combobox");
    expect(projectSelect).toBeDisabled();
  });

  it("updates an existing automation in edit mode", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    renderDialog({ automation: makeAutomation(), onOpenChange });
    await waitFor(() => {
      expect(mocks.apiGet).toHaveBeenCalledWith("/api/models");
    });

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(mocks.updateMutateAsync).toHaveBeenCalledWith({
        id: "auto-1",
        name: "Nightly audit",
        trigger: { type: "cron", expression: "0 2 * * *" },
        action: {
          type: "agent",
          modelId: "claude:opus-4-6",
          systemPromptInline: "Be strict.",
          userPromptInline: "Review the latest commit.",
        },
        notification: { onComplete: true, onFailure: false },
      });
    });

    expect(mocks.createMutateAsync).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("creates and navigates in create mode", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    renderDialog({ onOpenChange });
    await waitFor(() => {
      expect(mocks.apiGet).toHaveBeenCalledWith("/api/models");
    });

    await user.type(screen.getByPlaceholderText("e.g. Nightly code audit"), "Morning review");
    await user.type(screen.getByPlaceholderText("What should the agent do?"), "Check yesterday changes");
    await user.click(screen.getByRole("button", { name: "Create Automation" }));

    await waitFor(() => {
      expect(mocks.createMutateAsync).toHaveBeenCalledWith({
        name: "Morning review",
        projectId: undefined,
        trigger: { type: "cron", expression: "0 2 * * *" },
        action: {
          type: "agent",
          modelId: "claude:opus-4-6",
          userPromptInline: "Check yesterday changes",
        },
        notification: { onComplete: true, onFailure: true },
      });
    });

    expect(mocks.updateMutateAsync).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.navigate).toHaveBeenCalledWith("/automations/auto-new");
  });

  it("shows an inline validation message for invalid custom cron expressions", async () => {
    const user = userEvent.setup();
    renderDialog({});
    await waitFor(() => {
      expect(mocks.apiGet).toHaveBeenCalledWith("/api/models");
    });

    const selects = screen.getAllByRole("combobox");
    await user.selectOptions(selects[1], "");
    await user.type(screen.getByPlaceholderText("0 */6 * * *"), "bad-cron");

    expect(screen.getByText("Invalid cron expression")).toBeInTheDocument();
  });
});
