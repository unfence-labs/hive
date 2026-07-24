import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QuickOpenFileDialog } from "@/components/QuickOpenFileDialog";

vi.mock("@/hooks/useFileCompletions", () => ({
  useFileCompletions: () => ["src/App.tsx", "src/components/Sidebar.tsx"],
}));

describe("QuickOpenFileDialog", () => {
  it("filters and selects a workspace file", () => {
    const onOpenChange = vi.fn();
    const onSelect = vi.fn();
    render(
      <QuickOpenFileDialog
        open
        onOpenChange={onOpenChange}
        workspaceId="ws-1"
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText("App.tsx")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Search files by path…"), {
      target: { value: "sidebar" },
    });
    expect(screen.queryByText("App.tsx")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Sidebar.tsx"));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSelect).toHaveBeenCalledWith("src/components/Sidebar.tsx");
  });
});
