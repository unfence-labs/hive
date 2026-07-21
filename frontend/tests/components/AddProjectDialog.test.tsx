import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import AddProjectDialog from "@/components/AddProjectDialog";
import type { BrainState } from "@/types";

const brainMocks = vi.hoisted(() => ({
  brain: { exists: false } as BrainState,
  createBrain: vi.fn(),
}));

vi.mock("@/hooks/useBrain", () => ({
  useBrain: () => ({
    brain: brainMocks.brain,
    loading: false,
    error: null,
    createBrain: brainMocks.createBrain,
    connectBrain: vi.fn(),
    deleteBrain: vi.fn(),
  }),
}));

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: vi.fn().mockResolvedValue({
      ghInstalled: true,
      authenticated: true,
      user: { login: "octocat" },
    }),
  },
}));

function renderDialog(props: {
  onClone?: (url: string) => Promise<{ id: string } | void>;
  onCreate?: (params: { name: string; visibility?: "public" | "private" }) => Promise<{ id: string } | void>;
  onOpenChange?: (open: boolean) => void;
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AddProjectDialog
          open
          onOpenChange={props.onOpenChange ?? vi.fn()}
          onClone={props.onClone ?? vi.fn().mockResolvedValue(undefined)}
          onCreate={props.onCreate ?? vi.fn().mockResolvedValue(undefined)}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AddProjectDialog", () => {
  beforeEach(() => {
    brainMocks.brain = { exists: false };
    brainMocks.createBrain.mockReset();
    brainMocks.createBrain.mockResolvedValue({
      exists: true,
      repoUrl: "git@github.com:octocat/brain.git",
      createdAt: "2026-06-05T00:00:00.000Z",
    });
  });

  it("submits a project URL and closes dialog", async () => {
    const user = userEvent.setup();
    const onClone = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();

    renderDialog({ onClone, onOpenChange });

    await user.type(screen.getByPlaceholderText("https://github.com/user/repo.git"), "https://github.com/acme/repo.git");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(onClone).toHaveBeenCalledWith("https://github.com/acme/repo.git");
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("leaves repository URL normalization to the backend", async () => {
    const user = userEvent.setup();
    const onClone = vi.fn().mockResolvedValue(undefined);
    renderDialog({ onClone, onOpenChange: vi.fn() });

    await user.type(
      screen.getByPlaceholderText("https://github.com/user/repo.git"),
      "git@github.com:acme/repo.git",
    );
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(onClone).toHaveBeenCalledWith("git@github.com:acme/repo.git");
    });
  });

  it("shows error when submit fails", async () => {
    const user = userEvent.setup();
    const onClone = vi.fn().mockRejectedValue(new Error("Clone failed"));

    renderDialog({ onClone });

    await user.type(screen.getByPlaceholderText("https://github.com/user/repo.git"), "https://github.com/acme/repo.git");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText("Clone failed")).toBeInTheDocument();
  });

  it("creates a private Brain from the Brain option", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    renderDialog({ onOpenChange });

    await user.click(screen.getByRole("button", { name: "Brain" }));
    await user.type(screen.getByLabelText("Repository name"), "my-brain");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(brainMocks.createBrain).toHaveBeenCalledWith({ name: "my-brain" });
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("opens the existing Brain instead of creating another one", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    brainMocks.brain = {
      exists: true,
      repoUrl: "git@github.com:octocat/brain.git",
      createdAt: "2026-06-05T00:00:00.000Z",
    };

    renderDialog({ onOpenChange });

    await user.click(screen.getByRole("button", { name: "Open Brain" }));
    expect(screen.getByText("Brain already exists")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Open Brain" }).at(-1)!);

    expect(brainMocks.createBrain).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
