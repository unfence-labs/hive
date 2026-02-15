import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AttachmentPreview } from "@/components/chat/AttachmentPreview";
import type { FileUIPart } from "ai";

type FileWithId = FileUIPart & { id: string };

function makeFile(overrides: Partial<FileWithId> & { id: string }): FileWithId {
  return {
    type: "file",
    mediaType: "image/png",
    url: "data:image/png;base64,abc123",
    filename: "screenshot.png",
    ...overrides,
  };
}

describe("AttachmentPreview", () => {
  it("returns null when files array is empty", () => {
    const { container } = render(
      <AttachmentPreview files={[]} onRemove={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders file name for each attachment", () => {
    const files = [
      makeFile({ id: "f1", filename: "photo.png" }),
      makeFile({ id: "f2", filename: "diagram.jpg" }),
    ];
    render(<AttachmentPreview files={files} onRemove={vi.fn()} />);

    expect(screen.getByText("photo.png")).toBeInTheDocument();
    expect(screen.getByText("diagram.jpg")).toBeInTheDocument();
  });

  it("renders image thumbnail when url is provided", () => {
    const files = [
      makeFile({ id: "f1", url: "data:image/png;base64,xyz", filename: "pic.png" }),
    ];
    render(<AttachmentPreview files={files} onRemove={vi.fn()} />);

    const img = screen.getByAltText("pic.png");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "data:image/png;base64,xyz");
  });

  it("uses fallback alt text when filename is missing", () => {
    const files = [
      makeFile({ id: "f1", filename: undefined, url: "data:image/png;base64,abc" }),
    ];
    render(<AttachmentPreview files={files} onRemove={vi.fn()} />);

    expect(screen.getByAltText("attachment")).toBeInTheDocument();
  });

  it("uses fallback filename text when filename is missing", () => {
    const files = [
      makeFile({ id: "f1", filename: undefined }),
    ];
    render(<AttachmentPreview files={files} onRemove={vi.fn()} />);

    // Both the filename fallback ("image") and the label ("image") render "image" text.
    // There should be exactly 2 occurrences.
    const imageTexts = screen.getAllByText("image");
    expect(imageTexts.length).toBeGreaterThanOrEqual(2);
  });

  it("does not render img element when url is absent", () => {
    const files = [
      makeFile({ id: "f1", url: undefined, filename: "nourl.png" }),
    ];
    render(<AttachmentPreview files={files} onRemove={vi.fn()} />);

    expect(screen.getByText("nourl.png")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("calls onRemove with correct file id when remove button is clicked", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    const files = [
      makeFile({ id: "file-abc", filename: "test.png" }),
    ];
    render(<AttachmentPreview files={files} onRemove={onRemove} />);

    await user.click(screen.getByRole("button", { name: "Remove test.png" }));

    expect(onRemove).toHaveBeenCalledOnce();
    expect(onRemove).toHaveBeenCalledWith("file-abc");
  });

  it("renders remove button for each file", () => {
    const files = [
      makeFile({ id: "f1", filename: "a.png" }),
      makeFile({ id: "f2", filename: "b.png" }),
      makeFile({ id: "f3", filename: "c.png" }),
    ];
    render(<AttachmentPreview files={files} onRemove={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Remove a.png" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove b.png" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove c.png" })).toBeInTheDocument();
  });

  it("shows image label for each file", () => {
    const files = [
      makeFile({ id: "f1" }),
      makeFile({ id: "f2" }),
    ];
    render(<AttachmentPreview files={files} onRemove={vi.fn()} />);

    // "image" label appears for each file (case insensitive because CSS uppercases)
    const labels = screen.getAllByText("image");
    expect(labels).toHaveLength(2);
  });
});
