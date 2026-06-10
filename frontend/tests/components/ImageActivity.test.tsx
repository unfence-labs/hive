import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentActivityList } from "@/components/chat/AgentActivityList";
import type { AgentActivity } from "@/types";

function renderActivities(activities: AgentActivity[], showExecutingState?: boolean) {
  return render(<AgentActivityList activities={activities} showExecutingState={showExecutingState} />);
}

describe("ImageActivity", () => {
  it("renders an inline thumbnail for an in-workspace viewed image", () => {
    renderActivities([{
      id: "img-1",
      kind: "image_view",
      path: "/tmp/project/assets/screenshot.png",
      relativePath: "assets/screenshot.png",
      imageUrl: "/api/workspaces/ws-1/file/raw?path=assets%2Fscreenshot.png",
    }]);

    expect(screen.getByText("View image")).toBeInTheDocument();
    expect(screen.getByText("screenshot.png")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "screenshot.png" }))
      .toHaveAttribute("src", expect.stringContaining("/api/workspaces/ws-1/file/raw"));
  });

  it("opens a full-screen lightbox when the thumbnail is clicked", async () => {
    const user = userEvent.setup();
    renderActivities([{
      id: "img-1",
      kind: "image_view",
      path: "/tmp/project/assets/screenshot.png",
      relativePath: "assets/screenshot.png",
      imageUrl: "/api/workspaces/ws-1/file/raw?path=assets%2Fscreenshot.png",
    }]);

    // The lightbox trigger only appears once the thumbnail image has loaded.
    fireEvent.load(screen.getByRole("img", { name: "screenshot.png" }));
    await user.click(screen.getByRole("button", { name: "Open image" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("img", { name: "screenshot.png" })).toBeInTheDocument();
  });

  it("shows a no-preview tile and an explanation for an outside-workspace image", async () => {
    const user = userEvent.setup();
    renderActivities([{
      id: "img-1",
      kind: "image_view",
      path: "/var/data/elsewhere.png",
      outsideWorkspace: true,
    }]);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /View image/ }));
    expect(screen.getByText("Image is outside the workspace and cannot be previewed.")).toBeInTheDocument();
  });

  it("falls back to an error tile when a viewed image fails to load", () => {
    renderActivities([{
      id: "img-1",
      kind: "image_view",
      path: "/tmp/project/assets/screenshot.png",
      relativePath: "assets/screenshot.png",
      imageUrl: "/api/workspaces/ws-1/file/raw?path=assets%2Fscreenshot.png",
    }]);

    fireEvent.error(screen.getByRole("img", { name: "screenshot.png" }));
    expect(screen.getByLabelText("Preview unavailable")).toBeInTheDocument();
  });

  it("shows the animated placeholder while a generation is pending (live)", () => {
    renderActivities([{
      id: "gen-1",
      kind: "image_generation",
      status: "inProgress",
    }], true);

    expect(screen.getByText("Generate image")).toBeInTheDocument();
    expect(screen.getByText("generating…")).toBeInTheDocument();
    expect(screen.getByLabelText("Generating image")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("does not animate an in-progress generation in history (no executing state)", () => {
    renderActivities([{
      id: "gen-1",
      kind: "image_generation",
      status: "inProgress",
    }]);

    expect(screen.getByText("Generate image")).toBeInTheDocument();
    expect(screen.queryByText("generating…")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Generating image")).not.toBeInTheDocument();
  });

  it("renders the generated image inline and exposes the revised prompt on expand", async () => {
    const user = userEvent.setup();
    renderActivities([{
      id: "gen-1",
      kind: "image_generation",
      status: "completed",
      revisedPrompt: "A hive logo in watercolor",
      savedPath: "/tmp/project/generated/logo.png",
      relativePath: "generated/logo.png",
      imageUrl: "/api/workspaces/ws-1/file/raw?path=generated%2Flogo.png",
    }]);

    expect(screen.getByText("Generated image")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "A hive logo in watercolor" }))
      .toHaveAttribute("src", expect.stringContaining("/api/workspaces/ws-1/file/raw"));

    await user.click(screen.getByRole("button", { name: /Generate image/ }));
    expect(screen.getByText("A hive logo in watercolor")).toBeInTheDocument();
  });

  it("resolves a cached image without waiting for onLoad (old conversations)", () => {
    // A cached image is already `complete` on mount and never fires onLoad.
    const completeSpy = vi.spyOn(window.HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    const widthSpy = vi.spyOn(window.HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(64);
    try {
      renderActivities([{
        id: "gen-1",
        kind: "image_generation",
        status: "completed",
        result: "aGVsbG8=",
      }]);

      // Loaded straight away: the lightbox trigger is present and no placeholder.
      expect(screen.getByRole("button", { name: "Open image" })).toBeInTheDocument();
      expect(screen.queryByLabelText("Generating image")).not.toBeInTheDocument();
    } finally {
      completeSpy.mockRestore();
      widthSpy.mockRestore();
    }
  });

  it("falls back to an inline data URL when a generation has no saved file", () => {
    renderActivities([{
      id: "gen-1",
      kind: "image_generation",
      status: "completed",
      result: "aGVsbG8=",
    }]);

    expect(screen.getByRole("img", { name: "Generated image" }))
      .toHaveAttribute("src", "data:image/png;base64,aGVsbG8=");
  });
});
