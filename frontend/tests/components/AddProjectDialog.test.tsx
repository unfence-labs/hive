import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AddProjectDialog from "@/components/AddProjectDialog";

describe("AddProjectDialog", () => {
  it("submits a project URL and closes dialog", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();

    render(
      <AddProjectDialog
        open
        onOpenChange={onOpenChange}
        onSubmit={onSubmit}
      />,
    );

    await user.type(screen.getByPlaceholderText("git@github.com:user/repo.git"), "https://github.com/acme/repo.git");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith("https://github.com/acme/repo.git");
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows error when submit fails", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new Error("Clone failed"));

    render(
      <AddProjectDialog
        open
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    await user.type(screen.getByPlaceholderText("git@github.com:user/repo.git"), "https://github.com/acme/repo.git");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText("Clone failed")).toBeInTheDocument();
  });
});
