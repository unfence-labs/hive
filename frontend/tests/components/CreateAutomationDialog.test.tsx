import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CreateAutomationDialog from "@/components/CreateAutomationDialog";
import type { Agent, Automation, Project, PromptTemplate } from "@/types";

const mocks = vi.hoisted(() => ({
  useProjects: vi.fn(),
  usePromptTemplates: vi.fn(),
  useAgents: vi.fn(),
  useCreateAutomation: vi.fn(),
  useUpdateAutomation: vi.fn(),
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

vi.mock("@/hooks/useAgents", () => ({
  useAgents: mocks.useAgents,
}));

vi.mock("@/hooks/useAutomations", () => ({
  useCreateAutomation: mocks.useCreateAutomation,
  useUpdateAutomation: mocks.useUpdateAutomation,
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
    id: "tpl-u",
    name: "User Prompt",
    type: "user",
    content: "Review the codebase.",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    name: "Code Auditor",
    systemPrompt: "You are a code auditor.",
    modelId: "claude:opus-4-7",
    injectGitContext: true,
    readOnly: true,
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
      agentId: "agent-1",
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
    mocks.usePromptTemplates.mockReturnValue({ data: [makeTemplate()] });
    mocks.useAgents.mockReturnValue({ data: [makeAgent()] });
    mocks.useCreateAutomation.mockReturnValue({ mutateAsync: mocks.createMutateAsync, isPending: false });
    mocks.useUpdateAutomation.mockReturnValue({ mutateAsync: mocks.updateMutateAsync, isPending: false });
    mocks.createMutateAsync.mockResolvedValue({ id: "auto-new" });
    mocks.updateMutateAsync.mockResolvedValue(makeAutomation());
  });

  it("renders the agent selector and prefills it in edit mode", async () => {
    renderDialog({ automation: makeAutomation() });

    expect(screen.getByRole("heading", { name: "Edit Automation" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Nightly audit")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Review the latest commit.")).toBeInTheDocument();
    // Agent dropdown shows the agent name and is set to the referenced agent.
    expect(screen.getByRole("option", { name: "Code Auditor" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeInTheDocument();

    const [projectSelect] = screen.getAllByRole("combobox");
    expect(projectSelect).toBeDisabled();
  });

  it("updates an existing automation submitting the agentId", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    renderDialog({ automation: makeAutomation(), onOpenChange });

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(mocks.updateMutateAsync).toHaveBeenCalledWith({
        id: "auto-1",
        name: "Nightly audit",
        trigger: { type: "cron", expression: "0 2 * * *" },
        action: {
          type: "agent",
          agentId: "agent-1",
          userPromptInline: "Review the latest commit.",
        },
        notification: { onComplete: true, onFailure: false },
      });
    });

    expect(mocks.createMutateAsync).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("creates and navigates submitting the selected agentId", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    renderDialog({ onOpenChange });

    await user.type(screen.getByPlaceholderText("e.g. Nightly code audit"), "Morning review");
    // Comboboxes in order: Project (0), Schedule (1), Agent (2).
    const agentSelect = screen.getAllByRole("combobox")[2];
    await user.selectOptions(agentSelect, "agent-1");
    await user.type(screen.getByPlaceholderText("What should the agent do?"), "Check yesterday changes");
    await user.click(screen.getByRole("button", { name: "Create Automation" }));

    await waitFor(() => {
      expect(mocks.createMutateAsync).toHaveBeenCalledWith({
        name: "Morning review",
        projectId: undefined,
        trigger: { type: "cron", expression: "0 2 * * *" },
        action: {
          type: "agent",
          agentId: "agent-1",
          userPromptInline: "Check yesterday changes",
        },
        notification: { onComplete: true, onFailure: true },
      });
    });

    expect(mocks.updateMutateAsync).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.navigate).toHaveBeenCalledWith("/automations/auto-new");
  });

  it("shows an empty-state link to the Agents page when no agents exist", () => {
    mocks.useAgents.mockReturnValue({ data: [] });
    renderDialog({});

    const link = screen.getByRole("link", { name: "Agents settings page" });
    expect(link).toHaveAttribute("href", "/settings/user-agents");
  });

  it("shows an inline validation message for invalid custom cron expressions", async () => {
    const user = userEvent.setup();
    renderDialog({});

    const selects = screen.getAllByRole("combobox");
    // Schedule select is the second combobox (Project is first).
    await user.selectOptions(selects[1], "");
    await user.type(screen.getByPlaceholderText("0 */6 * * *"), "bad-cron");

    expect(screen.getByText("Invalid cron expression")).toBeInTheDocument();
  });
});
