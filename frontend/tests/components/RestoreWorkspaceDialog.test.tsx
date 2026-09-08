import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import RestoreWorkspaceDialog from "@/components/RestoreWorkspaceDialog";
import type { ArchivedWorkspaceItem } from "@/types";

const { apiGet, apiPost, apiDelete, toastError } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/hooks/useApi", () => ({
  api: { get: apiGet, post: apiPost, put: vi.fn(), patch: vi.fn(), delete: apiDelete },
  ApiError: class ApiError extends Error {},
}));

vi.mock("sonner", () => ({
  toast: { error: toastError, success: vi.fn() },
}));

const archives: ArchivedWorkspaceItem[] = [
  {
    id: "ws-new",
    name: "lyon",
    branch: "workspace/lyon",
    source: { kind: "pr", number: 12 },
    archivedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    branchExists: true,
    deletesBranch: true,
  },
  {
    id: "ws-old",
    name: "tokyo",
    branch: "workspace/tokyo",
    archivedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    branchExists: false,
    deletesBranch: false,
  },
];

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-path">{location.pathname}</div>;
}

function renderDialog(onOpenChange = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/home"]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <RestoreWorkspaceDialog open onOpenChange={onOpenChange} projectId="p1" />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onOpenChange, queryClient };
}

describe("RestoreWorkspaceDialog", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiDelete.mockReset();
    toastError.mockReset();
    apiGet.mockResolvedValue(archives);
  });

  it("lists archived workspaces in server order with branch details and archive time", async () => {
    renderDialog();

    await screen.findByText("lyon");
    expect(apiGet).toHaveBeenCalledWith("/api/projects/p1/archives");

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("lyon");
    expect(rows[0]).toHaveTextContent("#12");
    expect(rows[0]).toHaveTextContent("workspace/lyon");
    expect(rows[0]).toHaveTextContent("2h ago");
    expect(rows[1]).toHaveTextContent("tokyo");
    expect(rows[1]).toHaveTextContent("3d ago");
  });

  it("greys out a workspace whose branch is missing and disables its restore button", async () => {
    renderDialog();

    await screen.findByText("tokyo");
    const rows = screen.getAllByRole("listitem");
    expect(rows[1]).toHaveClass("opacity-60");
    expect(rows[1]).toHaveTextContent("Branch missing");
    expect(screen.getByRole("button", { name: "Restore tokyo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Restore lyon" })).toBeEnabled();
  });

  it("shows an empty state when nothing is archived", async () => {
    apiGet.mockResolvedValue([]);
    renderDialog();

    expect(await screen.findByText("No archived workspaces")).toBeInTheDocument();
  });

  it("shows an error when the list fails to load", async () => {
    apiGet.mockRejectedValue(new Error("boom"));
    renderDialog();

    expect(await screen.findByText("Failed to load archived workspaces")).toBeInTheDocument();
  });

  it("restores a workspace, closes the dialog, and navigates to it", async () => {
    apiPost.mockResolvedValue({ id: "ws-new", name: "lyon", branch: "workspace/lyon", status: "idle" });
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();

    await user.click(await screen.findByRole("button", { name: "Restore lyon" }));

    await waitFor(() => {
      expect(screen.getByTestId("location-path")).toHaveTextContent("/workspaces/ws-new");
    });
    expect(apiPost).toHaveBeenCalledWith("/api/workspaces/ws-new/restore");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("surfaces the server error and keeps the dialog open when restore is refused", async () => {
    apiPost.mockRejectedValue(new Error("Branch workspace/lyon is checked out elsewhere"));
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();

    await user.click(await screen.findByRole("button", { name: "Restore lyon" }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("Branch workspace/lyon is checked out elsewhere");
    });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("location-path")).toHaveTextContent("/home");
    expect(screen.getByRole("button", { name: "Restore lyon" })).toBeEnabled();
  });

  it("asks for confirmation before deleting, naming the workspace and its branch", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(await screen.findByRole("button", { name: "Delete lyon" }));

    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent("Delete archived workspace");
    expect(confirm).toHaveTextContent('"lyon" and its conversations will be permanently deleted.');
    expect(confirm).toHaveTextContent('The branch "workspace/lyon" will be removed too.');
    expect(apiDelete).not.toHaveBeenCalled();
  });

  it("omits the branch sentence when the branch is already missing", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(await screen.findByRole("button", { name: "Delete tokyo" }));

    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent('"tokyo" and its conversations will be permanently deleted.');
    expect(confirm).not.toHaveTextContent("will be removed too");
  });

  it("deletes the archive on confirm and drops the row after refetch", async () => {
    apiDelete.mockResolvedValue(undefined);
    apiGet.mockResolvedValueOnce(archives).mockResolvedValue([archives[1]]);
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();

    await user.click(await screen.findByRole("button", { name: "Delete lyon" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.queryByText("lyon")).not.toBeInTheDocument();
    });
    expect(apiDelete).toHaveBeenCalledWith("/api/workspaces/ws-new/archive");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByText("tokyo")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("sends nothing when the confirmation is cancelled", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(await screen.findByRole("button", { name: "Delete lyon" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(apiDelete).not.toHaveBeenCalled();
    expect(screen.getByText("lyon")).toBeInTheDocument();
  });

  it("surfaces the server error when deletion fails", async () => {
    apiDelete.mockRejectedValue(new Error("Delete failed"));
    const user = userEvent.setup();
    renderDialog();

    await user.click(await screen.findByRole("button", { name: "Delete lyon" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("Delete failed");
    });
    expect(screen.getByText("lyon")).toBeInTheDocument();
  });
});
