export const isMacPlatform =
  typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

interface ShortcutLabelOptions {
  shift?: boolean;
  control?: boolean;
  command?: boolean;
}

/** Display a platform-aware keyboard shortcut label. */
export function shortcutLabel(
  key: string,
  { shift = false, control = false, command = true }: ShortcutLabelOptions = {},
): string {
  if (isMacPlatform) {
    return `${control ? "⌃" : ""}${shift ? "⇧" : ""}${command ? "⌘" : ""}${key}`;
  }
  return `${command || control ? "Ctrl+" : ""}${shift ? "Shift+" : ""}${key}`;
}
