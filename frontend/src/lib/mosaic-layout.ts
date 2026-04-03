export interface MosaicLeaf {
  type: "leaf";
  wsId: string;
}
export interface MosaicSplit {
  type: "split";
  direction: "horizontal" | "vertical";
  children: MosaicNode[];
}
export type MosaicNode = MosaicLeaf | MosaicSplit;
export type DropZone = "left" | "right" | "top" | "bottom" | "center";

/** Extract all workspace IDs from a layout tree (in-order). */
export function getLeafIds(node: MosaicNode): string[] {
  if (node.type === "leaf") return [node.wsId];
  return node.children.flatMap(getLeafIds);
}

/** Build a default grid layout from an ordered list of IDs. */
export function buildDefaultLayout(ids: string[], columns = 2): MosaicNode | null {
  if (ids.length === 0) return null;
  if (ids.length === 1) return { type: "leaf", wsId: ids[0] };
  if (ids.length <= columns) {
    return {
      type: "split",
      direction: "horizontal",
      children: ids.map((id) => ({ type: "leaf" as const, wsId: id })),
    };
  }
  // Group into rows of `columns`
  const rows: MosaicNode[] = [];
  for (let i = 0; i < ids.length; i += columns) {
    const chunk = ids.slice(i, i + columns);
    rows.push(
      chunk.length === 1
        ? { type: "leaf", wsId: chunk[0] }
        : {
            type: "split",
            direction: "horizontal",
            children: chunk.map((id) => ({ type: "leaf" as const, wsId: id })),
          },
    );
  }
  return rows.length === 1 ? rows[0] : { type: "split", direction: "vertical", children: rows };
}

function removeLeaf(node: MosaicNode, wsId: string): MosaicNode | null {
  if (node.type === "leaf") return node.wsId === wsId ? null : node;
  const children = node.children
    .map((c) => removeLeaf(c, wsId))
    .filter((c): c is MosaicNode => c !== null);
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { ...node, children };
}

function replaceLeaf(
  node: MosaicNode,
  wsId: string,
  replacement: MosaicNode,
): MosaicNode {
  if (node.type === "leaf") return node.wsId === wsId ? replacement : node;
  return {
    ...node,
    children: node.children.map((c) => replaceLeaf(c, wsId, replacement)),
  };
}

function swapLeaves(node: MosaicNode, a: string, b: string): MosaicNode {
  if (node.type === "leaf") {
    if (node.wsId === a) return { type: "leaf", wsId: b };
    if (node.wsId === b) return { type: "leaf", wsId: a };
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
  const dragLeaf: MosaicLeaf = { type: "leaf", wsId: dragId };
  const newSplit: MosaicSplit = {
    type: "split",
    direction,
    children: dragFirst
      ? [dragLeaf, { type: "leaf", wsId: targetId }]
      : [{ type: "leaf", wsId: targetId }, dragLeaf],
  };

  result = replaceLeaf(result, targetId, newSplit);
  return cleanTree(result);
}

/** Remove a workspace from the layout. */
export function removeFromLayout(
  tree: MosaicNode,
  wsId: string,
): MosaicNode | null {
  const result = removeLeaf(tree, wsId);
  return result ? cleanTree(result) : null;
}

/** Add a workspace to the layout (appends to root). */
export function addToLayout(tree: MosaicNode, wsId: string): MosaicNode {
  const leaf: MosaicLeaf = { type: "leaf", wsId };
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
