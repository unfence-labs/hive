import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SkillsSettings from "@/pages/settings/SkillsSettings";
import { ApiError, api } from "@/hooks/useApi";
import type { SkillDetail, SkillSummary } from "@/types";
import { createWrapper } from "../test-utils";

vi.mock("@/components/AppLayout", () => ({
  SettingsHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="settings-header">{children}</div>
  ),
}));

vi.mock("@/components/MarkdownEditor", () => ({
  MarkdownEditor: ({
    value,
    onChange,
    ariaLabel,
  }: {
    value: string;
    onChange?: (value: string) => void;
    ariaLabel?: string;
  }) => (
    <textarea
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}));

vi.mock("@/hooks/useApi", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

function makeSkill(overrides: Partial<SkillSummary> = {}): SkillSummary {
  return {
    id: "reviewer",
    name: "reviewer",
    folderName: "reviewer",
    description: "Review code",
    userInvocable: true,
    syncStatus: "claude_only",
    providers: {
      claude: { present: true, path: "/home/me/.claude/skills/reviewer", isSymlink: false },
      codex: { present: false, path: "/home/me/.agents/skills/reviewer" },
    },
    ...overrides,
  };
}

function makeDetail(overrides: Partial<SkillDetail> = {}): SkillDetail {
  const summary = makeSkill(overrides);
  return {
    ...summary,
    content: "---\nname: reviewer\n---\n# Reviewer\n",
    contentProvider: "claude",
    providerContents: {
      claude: "---\nname: reviewer\n---\n# Reviewer\n",
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

const DEFAULT_SKILL_TEMPLATE = `---
name: new-skill
description: Describe when this skill should be used.
---

# New Skill

## Instructions

Describe the workflow, rules, and context this skill should provide.
`;

describe("SkillsSettings", () => {
  it("lists skills and opens the first skill with provider state", async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === "/api/settings/skills") return Promise.resolve({ skills: [makeSkill()] });
      if (url === "/api/settings/skills/reviewer") return Promise.resolve(makeDetail());
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });

    const { wrapper } = createWrapper();
    render(<SkillsSettings />, { wrapper });

    expect(await screen.findByText("reviewer")).toBeInTheDocument();
    expect(await screen.findByLabelText("reviewer SKILL.md")).toHaveValue(
      "---\nname: reviewer\n---\n# Reviewer\n",
    );
    expect(screen.getAllByText("Claude").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Codex").length).toBeGreaterThan(0);
  });

  it("saves edited SKILL.md content", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === "/api/settings/skills") return Promise.resolve({ skills: [makeSkill()] });
      if (url === "/api/settings/skills/reviewer") return Promise.resolve(makeDetail());
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    vi.mocked(api.put).mockResolvedValueOnce(
      makeDetail({
        syncStatus: "linked",
        providers: {
          claude: { present: true, path: "/home/me/.claude/skills/reviewer", isSymlink: true },
          codex: { present: true, path: "/home/me/.agents/skills/reviewer", isSymlink: false },
        },
        content: "---\nname: reviewer\n---\n# Updated\n",
      }),
    );

    const { wrapper } = createWrapper();
    render(<SkillsSettings />, { wrapper });

    const editor = await screen.findByLabelText("reviewer SKILL.md");
    await user.clear(editor);
    await user.type(editor, "---\nname: reviewer\n---\n# Updated\n");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith("/api/settings/skills/reviewer", {
        content: "---\nname: reviewer\n---\n# Updated\n",
      });
    });
  });

  it("syncs all missing skills from the header", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === "/api/settings/skills") return Promise.resolve({ skills: [makeSkill()] });
      if (url === "/api/settings/skills/reviewer") return Promise.resolve(makeDetail());
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    vi.mocked(api.post).mockResolvedValueOnce({ skills: [], syncedCount: 1 });

    const { wrapper } = createWrapper();
    render(<SkillsSettings />, { wrapper });

    await user.click(await screen.findByRole("button", { name: /Sync pending/i }));

    expect(api.post).toHaveBeenCalledWith("/api/settings/skills/sync-missing");
  });

  it("deletes an existing skill after confirmation", async () => {
    const user = userEvent.setup();
    const tester = makeSkill({
      id: "tester",
      name: "tester",
      folderName: "tester",
      description: "Run tests",
    });
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === "/api/settings/skills") return Promise.resolve({ skills: [makeSkill(), tester] });
      if (url === "/api/settings/skills/reviewer") return Promise.resolve(makeDetail());
      if (url === "/api/settings/skills/tester") {
        return Promise.resolve(
          makeDetail({
            ...tester,
            content: "---\nname: tester\n---\n# Tester\n",
            contentProvider: "codex",
            providerContents: {
              codex: "---\nname: tester\n---\n# Tester\n",
            },
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    vi.mocked(api.delete).mockResolvedValueOnce(undefined);

    const { wrapper } = createWrapper();
    render(<SkillsSettings />, { wrapper });

    await screen.findByLabelText("reviewer SKILL.md");
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/from Claude and Codex/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith("/api/settings/skills/reviewer");
    });
  });

  it("creates a local draft without saving it to the backend", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === "/api/settings/skills") return Promise.resolve({ skills: [] });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });

    const { wrapper } = createWrapper();
    render(<SkillsSettings />, { wrapper });

    await user.click(await screen.findByRole("button", { name: "New Skill" }));

    expect(screen.getAllByText("Unsaved").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("New skill SKILL.md")).toHaveValue(DEFAULT_SKILL_TEMPLATE);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("saves a modified new skill through the create endpoint", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === "/api/settings/skills") return Promise.resolve({ skills: [] });
      if (url === "/api/settings/skills/reviewer") return Promise.resolve(makeDetail());
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    vi.mocked(api.post).mockResolvedValueOnce(makeDetail());

    const { wrapper } = createWrapper();
    render(<SkillsSettings />, { wrapper });

    await user.click(await screen.findByRole("button", { name: "New Skill" }));
    const editor = screen.getByLabelText("New skill SKILL.md");
    const content = "---\nname: reviewer\n---\n# Reviewer\n";
    await user.clear(editor);
    await user.type(editor, content);
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith("/api/settings/skills", { content });
    });
  });

  it("shows a duplicate-name error and disables save after a create conflict", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === "/api/settings/skills") return Promise.resolve({ skills: [] });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError(409, "Skill already exists"));

    const { wrapper } = createWrapper();
    render(<SkillsSettings />, { wrapper });

    await user.click(await screen.findByRole("button", { name: "New Skill" }));
    const editor = screen.getByLabelText("New skill SKILL.md");
    await user.clear(editor);
    await user.type(editor, "---\nname: reviewer\n---\n# Reviewer\n");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Skill already exists");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("shows a diff for divergent provider copies", async () => {
    const user = userEvent.setup();
    const divergentSkill = makeSkill({
      syncStatus: "diverged",
      providers: {
        claude: { present: true, path: "/home/me/.claude/skills/reviewer", isSymlink: false },
        codex: { present: true, path: "/home/me/.agents/skills/reviewer", isSymlink: false },
      },
    });
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === "/api/settings/skills") return Promise.resolve({ skills: [divergentSkill] });
      if (url === "/api/settings/skills/reviewer") {
        return Promise.resolve(
          makeDetail({
            ...divergentSkill,
            content: "---\nname: reviewer\n---\n# Codex\n",
            contentProvider: "codex",
            providerContents: {
              claude: "---\nname: reviewer\n---\n# Claude\n",
              codex: "---\nname: reviewer\n---\n# Codex\n",
            },
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });

    const { wrapper } = createWrapper();
    render(<SkillsSettings />, { wrapper });

    await user.click(await screen.findByRole("button", { name: "View diff" }));

    expect(await screen.findByText("Skill diff")).toBeInTheDocument();
    expect(screen.getAllByText("Claude").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Codex").length).toBeGreaterThan(0);
    expect(screen.getByText("# Claude")).toBeInTheDocument();
    expect(screen.getByText("# Codex")).toBeInTheDocument();
  });
});
