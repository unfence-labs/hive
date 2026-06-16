import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SubagentsSettings from "@/pages/settings/SubagentsSettings";
import { ApiError, api } from "@/hooks/useApi";
import type { CustomAgentDetail, CustomAgentSummary } from "@/types";
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

vi.mock("@/components/CodeEditor", () => ({
  CodeEditor: ({
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

function makeAgent(overrides: Partial<CustomAgentSummary> = {}): CustomAgentSummary {
  return {
    id: "reviewer",
    name: "reviewer",
    description: "Review code",
    status: "claude_only",
    providers: {
      claude: { present: true, path: "/home/me/.claude/agents/reviewer.md", isSymlink: false },
      codex: { present: false, path: "/home/me/.codex/agents/reviewer.toml" },
    },
    ...overrides,
  };
}

function makeDetail(overrides: Partial<CustomAgentDetail> = {}): CustomAgentDetail {
  const summary = makeAgent(overrides);
  return {
    ...summary,
    contents: {
      claude: "---\nname: reviewer\n---\n# Reviewer\n",
    },
    manifests: {
      claude: {
        name: "reviewer",
        description: "Review code",
        developerInstructions: "# Reviewer",
      },
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SubagentsSettings", () => {
  it("lists subagents and opens the first agent", async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === "/api/settings/subagents") return Promise.resolve({ agents: [makeAgent()] });
      if (url === "/api/settings/subagents/reviewer") return Promise.resolve(makeDetail());
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });

    const { wrapper } = createWrapper();
    render(<SubagentsSettings />, { wrapper });

    expect(await screen.findByText("reviewer")).toBeInTheDocument();
    expect(await screen.findByLabelText("reviewer Claude subagent")).toHaveValue(
      "---\nname: reviewer\n---\n# Reviewer\n",
    );
    expect(screen.getAllByText("Claude").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Codex").length).toBeGreaterThan(0);
  });

  it("saves edited provider content", async () => {
    const user = userEvent.setup();
    const both = makeDetail({
      status: "both",
      providers: {
        claude: { present: true, path: "/home/me/.claude/agents/reviewer.md" },
        codex: { present: true, path: "/home/me/.codex/agents/reviewer.toml" },
      },
      contents: {
        claude: "---\nname: reviewer\n---\n# Reviewer\n",
        codex: "name = \"reviewer\"\ndeveloper_instructions = \"Review.\"\n",
      },
      manifests: {
        claude: { name: "reviewer", developerInstructions: "# Reviewer" },
        codex: { name: "reviewer", developerInstructions: "Review." },
      },
    });
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === "/api/settings/subagents") return Promise.resolve({ agents: [both] });
      if (url === "/api/settings/subagents/reviewer") return Promise.resolve(both);
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    vi.mocked(api.put).mockResolvedValueOnce({
      ...both,
      contents: {
        ...both.contents,
        codex: "name = \"reviewer\"\ndeveloper_instructions = \"Updated.\"\n",
      },
    });

    const { wrapper } = createWrapper();
    render(<SubagentsSettings />, { wrapper });

    await screen.findByLabelText("reviewer Claude subagent");
    await user.click(screen.getByRole("button", { name: /^Codex$/ }));
    const editor = await screen.findByLabelText("reviewer Codex subagent");
    await user.clear(editor);
    await user.type(editor, "name = \"reviewer\"\ndeveloper_instructions = \"Updated.\"\n");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith(
        "/api/settings/subagents/reviewer/providers/codex",
        { content: "name = \"reviewer\"\ndeveloper_instructions = \"Updated.\"\n" },
      );
    });
  });

  it("creates a missing provider counterpart explicitly", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === "/api/settings/subagents") return Promise.resolve({ agents: [makeAgent()] });
      if (url === "/api/settings/subagents/reviewer") return Promise.resolve(makeDetail());
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    vi.mocked(api.post).mockResolvedValueOnce(
      makeDetail({
        status: "both",
        providers: {
          claude: { present: true, path: "/home/me/.claude/agents/reviewer.md" },
          codex: { present: true, path: "/home/me/.codex/agents/reviewer.toml" },
        },
      }),
    );

    const { wrapper } = createWrapper();
    render(<SubagentsSettings />, { wrapper });

    await screen.findByLabelText("reviewer Claude subagent");
    await user.click(screen.getByRole("button", { name: /^Codex$/ }));
    await user.click(screen.getByRole("button", { name: "Create Codex version" }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/api/settings/subagents/reviewer/providers/codex/counterpart",
      );
    });
  });

  it("creates a new Codex subagent draft", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === "/api/settings/subagents") return Promise.resolve({ agents: [] });
      if (url === "/api/settings/subagents/reviewer") return Promise.resolve(makeDetail());
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    vi.mocked(api.post).mockResolvedValueOnce(makeDetail());

    const { wrapper } = createWrapper();
    render(<SubagentsSettings />, { wrapper });

    await user.click(await screen.findByRole("button", { name: "New Agent" }));
    await user.click(screen.getByRole("button", { name: "Codex" }));
    const editor = screen.getByLabelText("New subagent");
    const content = "name = \"reviewer\"\ndeveloper_instructions = \"Review changes.\"\n";
    await user.clear(editor);
    await user.type(editor, content);
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith("/api/settings/subagents", {
        provider: "codex",
        content,
      });
    });
  });

  it("shows a duplicate-name error after a create conflict", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === "/api/settings/subagents") return Promise.resolve({ agents: [] });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError(409, "Subagent already exists"));

    const { wrapper } = createWrapper();
    render(<SubagentsSettings />, { wrapper });

    await user.click(await screen.findByRole("button", { name: "New Agent" }));
    const editor = screen.getByLabelText("New subagent");
    await user.clear(editor);
    await user.type(editor, "---\nname: reviewer\n---\n# Reviewer\n");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Subagent already exists");
  });

  it("deletes a provider copy after confirmation", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === "/api/settings/subagents") return Promise.resolve({ agents: [makeAgent()] });
      if (url === "/api/settings/subagents/reviewer") return Promise.resolve(makeDetail());
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    vi.mocked(api.delete).mockResolvedValueOnce(undefined);

    const { wrapper } = createWrapper();
    render(<SubagentsSettings />, { wrapper });

    await screen.findByLabelText("reviewer Claude subagent");
    await user.click(screen.getByRole("button", { name: "Delete Claude" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Claude version/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith("/api/settings/subagents/reviewer/providers/claude");
    });
  });
});
