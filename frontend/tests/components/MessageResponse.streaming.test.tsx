import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MessageResponse } from "@/components/ai-elements/message";

describe("MessageResponse streaming controls", () => {
  it("enables copying when streaming ends without changing the code", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const markdown = "```bash\nnpm run dev\n";
    const { rerender } = render(
      <MessageResponse isAnimating>{markdown}</MessageResponse>,
    );

    expect(await screen.findByRole("button", { name: /copy code/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /download file/i })).toBeDisabled();

    rerender(<MessageResponse isAnimating={false}>{markdown}</MessageResponse>);

    await waitFor(() => expect(screen.getByRole("button", { name: /copy code/i })).toBeEnabled());
    expect(screen.getByRole("button", { name: /download file/i })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /copy code/i }));
    expect(writeText).toHaveBeenCalledWith("npm run dev\n");
  });

  it("enables a closed block while the response continues and keeps an open block disabled", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const first = "```bash\nnpm run dev\n";
    const { rerender } = render(<MessageResponse isAnimating>{first}</MessageResponse>);
    expect(await screen.findByRole("button", { name: /copy code/i })).toBeDisabled();

    rerender(<MessageResponse isAnimating>{first + "```"}</MessageResponse>);
    await waitFor(() => expect(screen.getByRole("button", { name: /copy code/i })).toBeEnabled());
    expect(screen.getByRole("button", { name: /download file/i })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /copy code/i }));
    expect(writeText).toHaveBeenCalledWith("npm run dev\n");

    rerender(<MessageResponse isAnimating>{first + "```\n\nNext command:\n\n```bash\nnpm test"}</MessageResponse>);
    await waitFor(() => expect(screen.getAllByRole("button", { name: /copy code/i })).toHaveLength(2));
    expect(screen.getAllByRole("button", { name: /copy code/i })[0]).toBeEnabled();
    expect(screen.getAllByRole("button", { name: /copy code/i })[1]).toBeDisabled();
  });

  it("updates table controls across streaming state changes with unchanged Markdown", async () => {
    const markdown = "| Command | Status |\n| --- | --- |\n| Tests | Passed |";
    const { rerender } = render(
      <MessageResponse isAnimating>{markdown}</MessageResponse>,
    );
    const controls = [
      await screen.findByRole("button", { name: /copy table/i }),
      screen.getByRole("button", { name: /download table/i }),
      screen.getByRole("button", { name: /view fullscreen/i }),
    ];
    for (const control of controls) expect(control).toBeDisabled();

    rerender(<MessageResponse isAnimating={false}>{markdown}</MessageResponse>);

    await waitFor(() => {
      for (const control of controls) expect(control).toBeEnabled();
    });

    rerender(<MessageResponse isAnimating>{markdown}</MessageResponse>);

    await waitFor(() => {
      for (const control of controls) expect(control).toBeDisabled();
    });
  });
});
