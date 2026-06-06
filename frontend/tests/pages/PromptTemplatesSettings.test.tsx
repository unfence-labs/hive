import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PromptTemplatesSettings from "@/pages/settings/PromptTemplatesSettings";
import { api } from "@/hooks/useApi";
import type { BasePromptData } from "@/types";
import { createWrapper } from "../test-utils";

vi.mock("@/components/AppLayout", () => ({
  SettingsHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="settings-header">{children}</div>
  ),
}));

vi.mock("@/components/PromptFlowExplainer", () => ({
  PromptFlowExplainer: () => <div data-testid="flow-explainer" />,
}));

vi.mock("@/components/PromptEditor", () => ({
  PromptEditor: ({
    value,
    onChange,
    readOnly,
  }: {
    value: string;
    onChange?: (value: string) => void;
    readOnly?: boolean;
  }) => (
    <textarea
      aria-label="prompt-editor"
      readOnly={!!readOnly}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
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

function makePromptData(overrides: Partial<BasePromptData> = {}): BasePromptData {
  return {
    content: "default content",
    isDefault: true,
    defaultContent: "default content",
    ...overrides,
  };
}

// Route GET calls to the right endpoint.
function mockGets(opts?: { base?: BasePromptData; brain?: BasePromptData }) {
  const base = opts?.base ?? makePromptData({ content: "build agent content" });
  const brain = opts?.brain ?? makePromptData({ content: "brain agent content" });
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === "/api/prompt-templates") return Promise.resolve([]);
    if (url === "/api/prompts/base") return Promise.resolve(base);
    if (url === "/api/prompts/brain") return Promise.resolve(brain);
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PromptTemplatesSettings — Brain prompt entry", () => {
  it("renders both pinned prompt items", async () => {
    mockGets();
    const { wrapper } = createWrapper();
    render(<PromptTemplatesSettings />, { wrapper });

    // "Build Agent Prompt" appears twice (list item + detail header) since it
    // is the default selection; "Brain Agent Prompt" only as a list item.
    await waitFor(() => {
      expect(screen.getAllByText("Build Agent Prompt").length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getByText("Brain Agent Prompt")).toBeInTheDocument();
  });

  it("defaults to the Build Agent Prompt detail", async () => {
    mockGets();
    const { wrapper } = createWrapper();
    render(<PromptTemplatesSettings />, { wrapper });

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "prompt-editor" })).toHaveValue(
        "build agent content",
      );
    });
    // Base passes the variables hint.
    expect(screen.getByText("Variables:")).toBeInTheDocument();
  });

  it("selecting the Brain entry shows its editor and description without variables", async () => {
    mockGets();
    const { wrapper } = createWrapper();
    render(<PromptTemplatesSettings />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("Brain Agent Prompt")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Brain Agent Prompt"));

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "prompt-editor" })).toHaveValue(
        "brain agent content",
      );
    });
    expect(
      screen.getByText(/The Brain's file map is appended automatically/i),
    ).toBeInTheDocument();
    // Brain detail passes no variables hint.
    expect(screen.queryByText("Variables:")).not.toBeInTheDocument();
  });

  it("saving the Brain prompt calls the brain update endpoint", async () => {
    mockGets();
    vi.mocked(api.put).mockResolvedValue(
      makePromptData({ content: "edited brain", isDefault: false }),
    );
    const { wrapper } = createWrapper();
    render(<PromptTemplatesSettings />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("Brain Agent Prompt")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText("Brain Agent Prompt"));

    const editor = await screen.findByRole("textbox", { name: "prompt-editor" });
    await waitFor(() => expect(editor).toHaveValue("brain agent content"));

    await userEvent.clear(editor);
    await userEvent.type(editor, "edited brain");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith("/api/prompts/brain", {
        content: "edited brain",
      });
    });
  });

  it("shows a Custom badge for a customized Brain prompt", async () => {
    mockGets({ brain: makePromptData({ content: "custom brain", isDefault: false }) });
    const { wrapper } = createWrapper();
    render(<PromptTemplatesSettings />, { wrapper });

    // Both pinned items render a badge; the Brain one should read "Custom".
    await waitFor(() => {
      expect(screen.getByText("Brain Agent Prompt")).toBeInTheDocument();
    });
    expect(screen.getAllByText("Custom").length).toBeGreaterThanOrEqual(1);
  });
});
