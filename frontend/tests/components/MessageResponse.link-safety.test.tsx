import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageResponse } from "@/components/ai-elements/message";

const mocks = vi.hoisted(() => ({
  openExternal: vi.fn(),
  streamdownProps: null as Record<string, unknown> | null,
}));

vi.mock("streamdown", () => ({
  Streamdown: (props: Record<string, unknown>) => {
    mocks.streamdownProps = props;
    return <div data-testid="streamdown">{props.children as string}</div>;
  },
}));

vi.mock("@/lib/open-external", () => ({
  openExternal: mocks.openExternal,
}));

describe("MessageResponse link safety modal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.streamdownProps = null;
  });

  it("opens URL via link safety modal confirm and closes it", async () => {
    const user = userEvent.setup();
    render(<MessageResponse>content</MessageResponse>);

    const onClose = vi.fn();
    const upstreamOnConfirm = vi.fn();
    const linkSafety = mocks.streamdownProps?.linkSafety as
      | {
          enabled?: boolean;
          renderModal: (props: {
            isOpen: boolean;
            onClose: () => void;
            onConfirm: () => void;
            url: string;
          }) => JSX.Element;
        }
      | undefined;

    expect(screen.getByTestId("streamdown")).toHaveTextContent("content");
    expect(linkSafety?.enabled).toBe(true);

    render(
      linkSafety!.renderModal({
        isOpen: true,
        onClose,
        onConfirm: upstreamOnConfirm,
        url: "https://example.com/guide",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Open link" }));

    expect(mocks.openExternal).toHaveBeenCalledWith("https://example.com/guide");
    expect(onClose).toHaveBeenCalled();
    expect(upstreamOnConfirm).not.toHaveBeenCalled();
  });
});
