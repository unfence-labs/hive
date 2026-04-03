export interface MosaicLeaf {
  type: "leaf";
  tileId: string;
}
export interface MosaicSplit {
  type: "split";
  direction: "horizontal" | "vertical";
  children: MosaicNode[];
}
export type MosaicNode = MosaicLeaf | MosaicSplit;
export type DropZone = "left" | "right" | "top" | "bottom" | "center";

/** Extract all tile IDs from a layout tree (in-order). */
export function getLeafIds(node: MosaicNode): string[] {
  if (node.type === "leaf") return [node.tileId];
  return node.children.flatMap(getLeafIds);
}

/** Build a default grid layout from an ordered list of IDs. */
export function buildDefaultLayout(ids: string[], columns = 2): MosaicNode | null {
  if (ids.length === 0) return null;
  if (ids.length === 1) return { type: "leaf", tileId: ids[0] };
  if (ids.length <= columns) {
    return {
      type: "split",
      direction: "horizontal",
      children: ids.map((id) => ({ type: "leaf" as const, tileId: id })),
    };
  }
  // Group into rows of `columns`
  const rows: MosaicNode[] = [];
  for (let i = 0; i < ids.length; i += columns) {
    const chunk = ids.slice(i, i + columns);
    rows.push(
      chunk.length === 1
        ? { type: "leaf", tileId: chunk[0] }
        : {
            type: "split",
            direction: "horizontal",
            children: chunk.map((id) => ({ type: "leaf" as const, tileId: id })),
          },
    );
  }
  return rows.length === 1 ? rows[0] : { type: "split", direction: "vertical", children: rows };
}

function removeLeaf(node: MosaicNode, tileId: string): MosaicNode | null {
  if (node.type === "leaf") return node.tileId === tileId ? null : node;
  const children = node.children
    .map((c) => removeLeaf(c, tileId))
    .filter((c): c is MosaicNode => c !== null);
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { ...node, children };
}

function replaceLeaf(
  node: MosaicNode,
  tileId: string,
  replacement: MosaicNode,
): MosaicNode {
  if (node.type === "leaf") return node.tileId === tileId ? replacement : node;
  return {
    ...node,
    children: node.children.map((c) => replaceLeaf(c, tileId, replacement)),
  };
}

function swapLeaves(node: MosaicNode, a: string, b: string): MosaicNode {
  if (node.type === "leaf") {
    if (node.tileId === a) return { type: "leaf", tileId: b };
    if (node.tileId === b) return { type: "leaf", tileId: a };
    return node;
  }
  return {
    ...node,
    children: node.children.map((c) => swapLeaves(c, a, b)),
  };
}

/** Flatten same-direction nested splits, unwrap single-child splits. */
function cleanTree(node: MosaicNode): MosaicNode {
  if (node.type === "leaf") return node;
  let children = node.children.map(cleanTree);
  const flat: MosaicNode[] = [];
  for (const c of children) {
    if (c.type === "split" && c.direction === node.direction) {
      flat.push(...c.children);
    } else {
      flat.push(c);
    }
  }
  children = flat;
  if (children.length === 1) return children[0];
  return { ...node, children };
}

/**
 * Apply a drop: move `dragId` relative to `targetId`.
 * - center → swap positions
 * - left/right → side-by-side (horizontal split)
 * - top/bottom → stacked (vertical split)
 */
export function applyDrop(
  tree: MosaicNode,
  dragId: string,
  targetId: string,
  zone: DropZone,
): MosaicNode {
  if (dragId === targetId) return tree;
  if (zone === "center") return swapLeaves(tree, dragId, targetId);

  // Remove dragged tile from tree
  let result = removeLeaf(tree, dragId);
  if (!result) return tree;

  const direction: "horizontal" | "vertical" =
    zone === "left" || zone === "right" ? "horizontal" : "vertical";
  const dragFirst = zone === "left" || zone === "top";
  const dragLeaf: MosaicLeaf = { type: "leaf", tileId: dragId };
  const newSplit: MosaicSplit = {
    type: "split",
    direction,
    children: dragFirst
      ? [dragLeaf, { type: "leaf", tileId: targetId }]
      : [{ type: "leaf", tileId: targetId }, dragLeaf],
  };

  result = replaceLeaf(result, targetId, newSplit);
  return cleanTree(result);
}

/** Remove a tile from the layout. */
export function removeFromLayout(
  tree: MosaicNode,
  tileId: string,
): MosaicNode | null {
  const result = removeLeaf(tree, tileId);
  return result ? cleanTree(result) : null;
}

/** Add a tile to the layout (appends to root). */
export function addToLayout(tree: MosaicNode, tileId: string): MosaicNode {
  const leaf: MosaicLeaf = { type: "leaf", tileId };
  if (tree.type === "leaf") {
    return {
      type: "split",
      direction: "horizontal",
      children: [tree, leaf],
    };
  }
  return cleanTree({ ...tree, children: [...tree.children, leaf] });
}

/** Determine which drop zone the cursor is in within a bounding rect. */
export function getDropZone(
  rect: DOMRect,
  x: number,
  y: number,
  threshold = 0.28,
): DropZone {
  const rx = (x - rect.left) / rect.width;
  const ry = (y - rect.top) / rect.height;
  if (rx < threshold) return "left";
  if (rx > 1 - threshold) return "right";
  if (ry < threshold) return "top";
  if (ry > 1 - threshold) return "bottom";
  return "center";
}
