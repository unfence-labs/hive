import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

  it("runs a custom toast action and dismisses the toast", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<Toaster toastOptions={{ unstyled: true }} />);

    act(() => {
      toast.custom((id) => (
        <HiveToast
          variant="warning"
          title="Hive"
          status="Input"
          description="Agent needs input"
          actionLabel="Respond"
          onAction={() => {
            onAction();
            toast.dismiss(id);
          }}
          onClose={() => toast.dismiss(id)}
        />
      ));
    });

    await user.click(await screen.findByRole("button", { name: "Respond" }));

    expect(onAction).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Respond" })).not.toBeInTheDocument();
    });
  });

  it("keeps control pointer events out of the swipe container", () => {
    const onPointerDown = vi.fn();
    render(
      <div onPointerDown={onPointerDown}>
        <HiveToast
          variant="warning"
          title="Hive"
          status="Input"
          description="Agent needs input"
          actionLabel="Respond"
          onAction={() => {}}
          onClose={() => {}}
        />
      </div>,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "Respond" }));

    const closeIcon = screen.getByRole("button", { name: "Dismiss" }).querySelector("svg");
    expect(closeIcon).not.toBeNull();
    fireEvent.pointerDown(closeIcon as SVGSVGElement);

    expect(onPointerDown).not.toHaveBeenCalled();
  });
});
