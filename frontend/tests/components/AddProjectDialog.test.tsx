import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import AddProjectDialog from "@/components/AddProjectDialog";

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
  it("submits a project URL and closes dialog", async () => {
    const user = userEvent.setup();
    const onClone = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();

    renderDialog({ onClone, onOpenChange });

    await user.type(screen.getByPlaceholderText("git@github.com:user/repo.git"), "https://github.com/acme/repo.git");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(onClone).toHaveBeenCalledWith("https://github.com/acme/repo.git");
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows error when submit fails", async () => {
    const user = userEvent.setup();
    const onClone = vi.fn().mockRejectedValue(new Error("Clone failed"));

    renderDialog({ onClone });

    await user.type(screen.getByPlaceholderText("git@github.com:user/repo.git"), "https://github.com/acme/repo.git");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText("Clone failed")).toBeInTheDocument();
  });
});
