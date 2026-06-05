import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrainFileTree } from "@/components/brain/BrainFileTree";
import type { WorkspaceFileTreeNode } from "@/types";

// Control the virtualizer so windowing is deterministic in jsdom (which has no
// layout). `count` reflects the flattened visible-row list; `getVirtualItems`
// returns only the windowed slice we configure per test.
const virtualState = vi.hoisted(() => ({ windowSize: Infinity }));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => {
    const visible = Math.min(count, virtualState.windowSize);
    return {
      getTotalSize: () => count * 28,
      getVirtualItems: () =>
        Array.from({ length: visible }, (_, index) => ({
          index,
          key: index,
          start: index * 28,
          size: 28,
        })),
    };
  },
}));

function buildLargeTree(fileCount: number): WorkspaceFileTreeNode[] {
  return Array.from({ length: fileCount }, (_, i) => ({
    name: `note-${i}.md`,
    path: `note-${i}.md`,
    type: "file" as const,
  }));
}

const nestedTree: WorkspaceFileTreeNode[] = [
  {
    name: "folder",
    path: "folder",
    type: "directory",
    children: [{ name: "child.md", path: "folder/child.md", type: "file" }],
  },
  { name: "root.md", path: "root.md", type: "file" },
];

function renderTree(
  overrides: Partial<React.ComponentProps<typeof BrainFileTree>> = {},
  nodes: WorkspaceFileTreeNode[] = buildLargeTree(2000),
) {
  const props = {
    nodes,
    selectedPath: "",
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  render(<BrainFileTree {...props} />);
  return props;
}

describe("BrainFileTree (virtualized)", () => {
  beforeEach(() => {
    virtualState.windowSize = Infinity;
    vi.clearAllMocks();
  });

  it("only mounts the windowed slice of a large tree, not every node", () => {
    virtualState.windowSize = 20; // Simulate a viewport showing ~20 rows.
    renderTree({}, buildLargeTree(2000));

    const treeitems = screen.getAllByRole("treeitem");
    expect(treeitems).toHaveLength(20);
    // The tree is aware of all 2000 rows via total size, but does not mount them.
    expect(screen.queryByText("note-1500.md")).not.toBeInTheDocument();
  });

  it("emits children only for expanded folders (collapsed folders hide them)", async () => {
    const user = userEvent.setup();
    renderTree({}, nestedTree);

    // Collapsed: child is not rendered.
    expect(screen.queryByText("child.md")).not.toBeInTheDocument();
    const folder = screen.getByRole("treeitem", { name: /folder/ });
    expect(folder).toHaveAttribute("aria-expanded", "false");

    // Expand → child becomes visible.
    await user.click(folder);
    expect(screen.getByText("child.md")).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: /folder/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("selects a file on click", async () => {
    const user = userEvent.setup();
    const props = renderTree({}, buildLargeTree(5));

    await user.click(screen.getByText("note-2.md"));
    expect(props.onSelect).toHaveBeenCalledWith("note-2.md");
  });

  it("creates a new note via the input", async () => {
    const user = userEvent.setup();
    const props = renderTree({}, buildLargeTree(1));

    await user.click(screen.getByRole("button", { name: "New note" }));
    const input = screen.getByLabelText("New note path");
    await user.type(input, "new.md{Enter}");
    expect(props.onCreate).toHaveBeenCalledWith("new.md");
  });

  it("renames a file through the dialog", async () => {
    const user = userEvent.setup();
    const props = renderTree({}, buildLargeTree(1));

    const row = screen.getByText("note-0.md").closest('[role="treeitem"]')!;
    await user.click(within(row as HTMLElement).getByRole("button", { name: /Rename/ }));
    const input = screen.getByLabelText("New path");
    await user.clear(input);
    await user.type(input, "renamed.md{Enter}");
    expect(props.onRename).toHaveBeenCalledWith("note-0.md", "renamed.md");
  });

  it("deletes a file after confirmation", async () => {
    const user = userEvent.setup();
    const props = renderTree({}, buildLargeTree(1));

    const row = screen.getByText("note-0.md").closest('[role="treeitem"]')!;
    await user.click(within(row as HTMLElement).getByRole("button", { name: /Delete/ }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(props.onDelete).toHaveBeenCalledWith("note-0.md");
  });

  it("shows an empty state when there are no notes", () => {
    renderTree({}, []);
    expect(screen.getByText("No notes yet.")).toBeInTheDocument();
  });

  it("shows the error state when listing fails", () => {
    renderTree({ error: "boom" }, []);
    expect(screen.getByText("boom")).toBeInTheDocument();
  });
});
