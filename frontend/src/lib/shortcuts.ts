export const isMacPlatform =
  typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

/** Display label for a Cmd/Ctrl shortcut, e.g. "⌘N" / "Ctrl+N". */
export function shortcutLabel(key: string, { shift = false } = {}): string {
  return isMacPlatform
    ? `${shift ? "⇧" : ""}⌘${key}`
    : `Ctrl+${shift ? "Shift+" : ""}${key}`;
}
