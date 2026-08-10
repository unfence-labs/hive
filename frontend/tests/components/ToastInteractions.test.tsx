import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { Toaster, toast } from "sonner";
import { HiveToast } from "@/components/ui/toaster";

describe("toast interactions", () => {
  beforeEach(() => toast.dismiss());

  it("dismisses a custom toast from its close button", async () => {
    const user = userEvent.setup();
    render(<Toaster toastOptions={{ unstyled: true }} />);

    act(() => {
      toast.custom((id) => (
        <HiveToast
          variant="success"
          title="Hive"
          status="Done"
          description="Task completed"
          onClose={() => toast.dismiss(id)}
        />
      ));
    });

    await user.click(await screen.findByRole("button", { name: "Dismiss" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
    });
  });
});
