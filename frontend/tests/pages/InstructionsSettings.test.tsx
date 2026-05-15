import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import InstructionsSettings from "@/pages/settings/InstructionsSettings";
import { api } from "@/hooks/useApi";
import type { InstructionDetail } from "@/types";
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
    placeholder,
  }: {
    value: string;
    onChange?: (value: string) => void;
    ariaLabel?: string;
    placeholder?: string;
  }) => (
    <textarea
      aria-label={ariaLabel}
      placeholder={placeholder}
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

function makeInstructions(overrides: Partial<InstructionDetail> = {}): InstructionDetail {
  return {
    content: "# Global\n",
    contentProvider: "codex",
    syncStatus: "linked",
    providers: {
      claude: { present: true, path: "/home/me/.claude/CLAUDE.md", isSymlink: true },
      codex: { present: true, path: "/home/me/.codex/AGENTS.md", isSymlink: false },
    },
    providerContents: {
      codex: "# Global\n",
    },
    override: {
      present: false,
      active: false,
      path: "/home/me/.codex/AGENTS.override.md",
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("InstructionsSettings", () => {
  it("loads missing instructions and keeps save disabled until content is entered", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(
      makeInstructions({
        content: "",
        contentProvider: null,
        syncStatus: "missing",
        providers: {
          claude: { present: false, path: "/home/me/.claude/CLAUDE.md" },
          codex: { present: false, path: "/home/me/.codex/AGENTS.md" },
        },
        providerContents: {},
      }),
    );

    const { wrapper } = createWrapper();
    render(<InstructionsSettings />, { wrapper });

    expect(await screen.findByText("Global Instructions")).toBeInTheDocument();
    expect(screen.getByText("Missing")).toBeInTheDocument();
    expect(screen.getByLabelText("Global instructions AGENTS.md")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("saves edited AGENTS.md content", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue(makeInstructions());
    vi.mocked(api.put).mockResolvedValueOnce(
      makeInstructions({
        content: "# Updated\n",
        providerContents: { codex: "# Updated\n" },
      }),
    );

    const { wrapper } = createWrapper();
    render(<InstructionsSettings />, { wrapper });

    const editor = await screen.findByLabelText("Global instructions AGENTS.md");
    await user.clear(editor);
    await user.type(editor, "# Updated\n");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith("/api/settings/instructions", {
        content: "# Updated\n",
      });
    });
  });

  it("syncs Claude-only instructions", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue(
      makeInstructions({
        content: "# Claude\n",
        contentProvider: "claude",
        syncStatus: "claude_only",
        providers: {
          claude: { present: true, path: "/home/me/.claude/CLAUDE.md", isSymlink: false },
          codex: { present: false, path: "/home/me/.codex/AGENTS.md" },
        },
        providerContents: { claude: "# Claude\n" },
      }),
    );
    vi.mocked(api.post).mockResolvedValueOnce(makeInstructions({ content: "# Claude\n" }));

    const { wrapper } = createWrapper();
    render(<InstructionsSettings />, { wrapper });

    await user.click(await screen.findByRole("button", { name: "Sync" }));

    expect(api.post).toHaveBeenCalledWith("/api/settings/instructions/sync");
  });

  it("shows an AGENTS.override.md warning", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(
      makeInstructions({
        override: {
          present: true,
          active: true,
          path: "/home/me/.codex/AGENTS.override.md",
        },
      }),
    );

    const { wrapper } = createWrapper();
    render(<InstructionsSettings />, { wrapper });

    expect(await screen.findByText(/AGENTS\.override\.md/)).toBeInTheDocument();
    expect(screen.getByText(/Hive will not modify it/i)).toBeInTheDocument();
  });

  it("shows a diff for divergent provider copies", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValueOnce(
      makeInstructions({
        content: "# Codex\n",
        syncStatus: "diverged",
        providers: {
          claude: { present: true, path: "/home/me/.claude/CLAUDE.md", isSymlink: false },
          codex: { present: true, path: "/home/me/.codex/AGENTS.md", isSymlink: false },
        },
        providerContents: {
          claude: "# Claude\n",
          codex: "# Codex\n",
        },
      }),
    );

    const { wrapper } = createWrapper();
    render(<InstructionsSettings />, { wrapper });

    await user.click(await screen.findByRole("button", { name: "View diff" }));

    expect(await screen.findByText("Instructions diff")).toBeInTheDocument();
    expect(screen.getByText("# Claude")).toBeInTheDocument();
    expect(screen.getAllByText("# Codex").length).toBeGreaterThan(0);
  });

  it("deletes existing instructions after confirmation", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue(makeInstructions());
    vi.mocked(api.delete).mockResolvedValueOnce(undefined);

    const { wrapper } = createWrapper();
    render(<InstructionsSettings />, { wrapper });

    await screen.findByLabelText("Global instructions AGENTS.md");
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/AGENTS\.override\.md/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith("/api/settings/instructions");
    });
  });
});
