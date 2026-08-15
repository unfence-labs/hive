import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppResyncOverlay } from "@/components/AppResyncOverlay";

describe("AppResyncOverlay", () => {
  it("announces the sync and restores focus when it closes", () => {
    const previous = document.createElement("button");
    document.body.append(previous);
    previous.focus();

    const { unmount } = render(<AppResyncOverlay />);
    const overlay = screen.getByRole("status", { name: "Syncing Hive" });

    expect(overlay).toHaveFocus();
    expect(screen.getByText("Syncing Hive…")).toBeInTheDocument();

    unmount();
    expect(previous).toHaveFocus();
    previous.remove();
  });
});
