import { describe, expect, it } from "vitest";
import {
  type MosaicNode,
  getLeafIds,
  buildDefaultLayout,
  applyDrop,
  removeFromLayout,
  addToLayout,
  getDropZone,
} from "@/lib/mosaic-layout";

describe("getLeafIds", () => {
  it("returns single ID from a leaf", () => {
    expect(getLeafIds({ type: "leaf", tileId: "a" })).toEqual(["a"]);
  });

  it("returns all IDs from a nested tree", () => {
    const tree: MosaicNode = {
      type: "split",
      direction: "vertical",
      children: [
        {
          type: "split",
          direction: "horizontal",
          children: [
            { type: "leaf", tileId: "a" },
            { type: "leaf", tileId: "b" },
          ],
        },
        { type: "leaf", tileId: "c" },
      ],
    };
    expect(getLeafIds(tree)).toEqual(["a", "b", "c"]);
  });
});

describe("buildDefaultLayout", () => {
  it("returns null for empty IDs", () => {
    expect(buildDefaultLayout([])).toBeNull();
  });

  it("returns a leaf for 1 ID", () => {
    expect(buildDefaultLayout(["a"])).toEqual({ type: "leaf", tileId: "a" });
  });

  it("returns a horizontal split for 2 IDs", () => {
    const layout = buildDefaultLayout(["a", "b"]);
    expect(layout).toEqual({
      type: "split",
      direction: "horizontal",
      children: [
        { type: "leaf", tileId: "a" },
        { type: "leaf", tileId: "b" },
      ],
    });
  });

  it("returns a 2×2 grid for 4 IDs", () => {
    const layout = buildDefaultLayout(["a", "b", "c", "d"]);
    expect(layout).toEqual({
      type: "split",
      direction: "vertical",
      children: [
        {
          type: "split",
          direction: "horizontal",
          children: [
            { type: "leaf", tileId: "a" },
            { type: "leaf", tileId: "b" },
          ],
        },
        {
          type: "split",
          direction: "horizontal",
          children: [
            { type: "leaf", tileId: "c" },
            { type: "leaf", tileId: "d" },
          ],
        },
      ],
    });
  });

  it("returns V(H(a,b), c) for 3 IDs", () => {
    const layout = buildDefaultLayout(["a", "b", "c"]);
    expect(layout).toEqual({
      type: "split",
      direction: "vertical",
      children: [
        {
          type: "split",
          direction: "horizontal",
          children: [
            { type: "leaf", tileId: "a" },
            { type: "leaf", tileId: "b" },
          ],
        },
        { type: "leaf", tileId: "c" },
      ],
    });
  });
});

describe("buildDefaultLayout with columns=3", () => {
  it("returns a 3-wide horizontal split for 3 IDs", () => {
    const layout = buildDefaultLayout(["a", "b", "c"], 3);
    expect(layout).toEqual({
      type: "split",
      direction: "horizontal",
      children: [
        { type: "leaf", tileId: "a" },
        { type: "leaf", tileId: "b" },
        { type: "leaf", tileId: "c" },
      ],
    });
  });

  it("returns V(H(a,b,c), d) for 4 IDs with columns=3", () => {
    const layout = buildDefaultLayout(["a", "b", "c", "d"], 3);
    expect(layout).toEqual({
      type: "split",
      direction: "vertical",
      children: [
        {
          type: "split",
          direction: "horizontal",
          children: [
            { type: "leaf", tileId: "a" },
            { type: "leaf", tileId: "b" },
            { type: "leaf", tileId: "c" },
          ],
        },
        { type: "leaf", tileId: "d" },
      ],
    });
  });

  it("returns a horizontal split for 2 IDs with columns=3", () => {
    const layout = buildDefaultLayout(["a", "b"], 3);
    expect(layout).toEqual({
      type: "split",
      direction: "horizontal",
      children: [
        { type: "leaf", tileId: "a" },
        { type: "leaf", tileId: "b" },
      ],
    });
  });

  it("returns a leaf for 1 ID with columns=3", () => {
    expect(buildDefaultLayout(["a"], 3)).toEqual({ type: "leaf", tileId: "a" });
  });
});

describe("applyDrop", () => {
  it("swaps tiles on center drop", () => {
    const tree: MosaicNode = {
      type: "split",
      direction: "horizontal",
      children: [
        { type: "leaf", tileId: "a" },
        { type: "leaf", tileId: "b" },
      ],
    };
    const result = applyDrop(tree, "a", "b", "center");
    expect(getLeafIds(result)).toEqual(["b", "a"]);
  });

  it("creates horizontal split on right drop", () => {
    const tree: MosaicNode = {
      type: "split",
      direction: "vertical",
      children: [
        { type: "leaf", tileId: "a" },
        { type: "leaf", tileId: "b" },
      ],
    };
    // Drag a to right of b → b should be left, a should be right
    const result = applyDrop(tree, "a", "b", "right");
    expect(result).toEqual({
      type: "split",
      direction: "horizontal",
      children: [
        { type: "leaf", tileId: "b" },
        { type: "leaf", tileId: "a" },
      ],
    });
  });

  it("creates horizontal split on left drop", () => {
    const tree: MosaicNode = {
      type: "split",
      direction: "vertical",
      children: [
        { type: "leaf", tileId: "a" },
        { type: "leaf", tileId: "b" },
      ],
    };
    const result = applyDrop(tree, "a", "b", "left");
    expect(result).toEqual({
      type: "split",
      direction: "horizontal",
      children: [
        { type: "leaf", tileId: "a" },
        { type: "leaf", tileId: "b" },
      ],
    });
  });

  it("creates vertical split on bottom drop", () => {
    const tree: MosaicNode = {
      type: "split",
      direction: "horizontal",
      children: [
        { type: "leaf", tileId: "a" },
        { type: "leaf", tileId: "b" },
      ],
    };
    // Drag a to bottom of b → b on top, a on bottom
    const result = applyDrop(tree, "a", "b", "bottom");
    expect(result).toEqual({
      type: "split",
      direction: "vertical",
      children: [
        { type: "leaf", tileId: "b" },
        { type: "leaf", tileId: "a" },
      ],
    });
  });

  it("creates nested split in a 3-tile tree", () => {
    // Start: V(H(a,b), c)
    // Drag c to right of a → V(H(H(a,c),b)) → cleaned → H(H(a,c),b)
    // Wait, let me think again:
    // 1. Remove c from tree → H(a,b)
    // 2. Replace a with H(a,c) → H(H(a,c), b)
    // 3. Clean: flatten → H(a, c, b) since inner H same dir as outer H
    const tree = buildDefaultLayout(["a", "b", "c"])!;
    const result = applyDrop(tree, "c", "a", "right");
    expect(getLeafIds(result)).toEqual(["a", "c", "b"]);
    expect(result).toEqual({
      type: "split",
      direction: "horizontal",
      children: [
        { type: "leaf", tileId: "a" },
        { type: "leaf", tileId: "c" },
        { type: "leaf", tileId: "b" },
      ],
    });
  });

  it("creates cross-direction nesting", () => {
    // Start: H(a, b), drag a to bottom of b → V(b, a)
    const tree: MosaicNode = {
      type: "split",
      direction: "horizontal",
      children: [
        { type: "leaf", tileId: "a" },
        { type: "leaf", tileId: "b" },
      ],
    };
    const result = applyDrop(tree, "a", "b", "bottom");
    expect(result).toEqual({
      type: "split",
      direction: "vertical",
      children: [
        { type: "leaf", tileId: "b" },
        { type: "leaf", tileId: "a" },
      ],
    });
  });

  it("returns tree unchanged when dragging onto self", () => {
    const tree: MosaicNode = {
      type: "split",
      direction: "horizontal",
      children: [
        { type: "leaf", tileId: "a" },
        { type: "leaf", tileId: "b" },
      ],
    };
    expect(applyDrop(tree, "a", "a", "left")).toBe(tree);
  });
});

describe("removeFromLayout", () => {
  it("returns null when removing the only leaf", () => {
    expect(removeFromLayout({ type: "leaf", tileId: "a" }, "a")).toBeNull();
  });

  it("returns remaining leaf when removing from 2-tile split", () => {
    const tree: MosaicNode = {
      type: "split",
      direction: "horizontal",
      children: [
        { type: "leaf", tileId: "a" },
        { type: "leaf", tileId: "b" },
      ],
    };
    expect(removeFromLayout(tree, "a")).toEqual({ type: "leaf", tileId: "b" });
  });

  it("cleans up nested splits", () => {
    const tree: MosaicNode = {
      type: "split",
      direction: "vertical",
      children: [
        {
          type: "split",
          direction: "horizontal",
          children: [
            { type: "leaf", tileId: "a" },
            { type: "leaf", tileId: "b" },
          ],
        },
        { type: "leaf", tileId: "c" },
      ],
    };
    // Remove a → V(b, c)
    const result = removeFromLayout(tree, "a");
    expect(result).toEqual({
      type: "split",
      direction: "vertical",
      children: [
        { type: "leaf", tileId: "b" },
        { type: "leaf", tileId: "c" },
      ],
    });
  });
});

describe("addToLayout", () => {
  it("creates horizontal split from a leaf", () => {
    const result = addToLayout({ type: "leaf", tileId: "a" }, "b");
    expect(result).toEqual({
      type: "split",
      direction: "horizontal",
      children: [
        { type: "leaf", tileId: "a" },
        { type: "leaf", tileId: "b" },
      ],
    });
  });

  it("appends to existing split", () => {
    const tree: MosaicNode = {
      type: "split",
      direction: "horizontal",
      children: [
        { type: "leaf", tileId: "a" },
        { type: "leaf", tileId: "b" },
      ],
    };
    const result = addToLayout(tree, "c");
    expect(getLeafIds(result)).toEqual(["a", "b", "c"]);
  });
});

describe("getDropZone", () => {
  const rect = { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 } as DOMRect;

  it("returns left for cursor near left edge", () => {
    expect(getDropZone(rect, 10, 50)).toBe("left");
  });

  it("returns right for cursor near right edge", () => {
    expect(getDropZone(rect, 90, 50)).toBe("right");
  });

  it("returns top for cursor near top edge", () => {
    expect(getDropZone(rect, 50, 10)).toBe("top");
  });

  it("returns bottom for cursor near bottom edge", () => {
    expect(getDropZone(rect, 50, 90)).toBe("bottom");
  });

  it("returns center for cursor in the middle", () => {
    expect(getDropZone(rect, 50, 50)).toBe("center");
  });

  it("prioritizes left/right over top/bottom in corners", () => {
    // Top-left corner: x=5, y=5 → rx=0.05, ry=0.05 → left wins (checked first)
    expect(getDropZone(rect, 5, 5)).toBe("left");
  });
});
