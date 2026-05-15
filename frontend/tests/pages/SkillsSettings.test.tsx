import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SkillsSettings from "@/pages/settings/SkillsSettings";
import { api } from "@/hooks/useApi";
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

describe("SkillsSettings", () => {
  it("lists skills with provider badges and opens the first skill", async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === "/api/settings/skills") return Promise.resolve({ skills: [makeSkill()] });
      if (url === "/api/settings/skills/reviewer") return Promise.resolve(makeDetail());
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });

    const { wrapper } = createWrapper();
    render(<SkillsSettings />, { wrapper });

    expect(await screen.findByText("reviewer")).toBeInTheDocument();
    expect(screen.getAllByText("Claude").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Codex").length).toBeGreaterThan(0);
    expect(await screen.findByLabelText("reviewer SKILL.md")).toHaveValue(
      "---\nname: reviewer\n---\n# Reviewer\n",
    );
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
