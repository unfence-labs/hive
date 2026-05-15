export type SettingsResourceSelection =
  | { kind: "existing"; id: string }
  | { kind: "draft" }
  | null;

export function resolveSettingsResourceSelection<T extends { id: string }>(
  selection: SettingsResourceSelection,
  resources: T[],
  hasDraft: boolean,
): SettingsResourceSelection {
  if (selection?.kind === "draft") return hasDraft ? selection : null;
  if (selection?.kind === "existing" && resources.some((resource) => resource.id === selection.id)) {
    return selection;
  }
  if (resources[0]) return { kind: "existing", id: resources[0].id };
  return hasDraft ? { kind: "draft" } : null;
}
