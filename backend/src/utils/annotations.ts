import type { UiAnnotation } from "../types.js";

/**
 * Serialize preview annotations into the markdown block appended to the
 * prompt sent to the agent CLI. The displayed/persisted message keeps the
 * user's clean text; only the CLI content carries this block.
 */
export function annotationsToMarkdown(annotations: UiAnnotation[]): string {
  const lines: string[] = [
    "## UI annotations (Hive preview)",
    "The user annotated the running app's UI in the Hive preview. Locate each annotated element in the source code and apply the requested change.",
    "",
  ];
  for (const a of annotations) {
    lines.push(`### ${a.id}. ${a.note || "(no note)"}`);
    lines.push(`- Page: ${a.pageUrl}`);
    if (a.kind === "element") {
      if (a.selector) lines.push(`- Selector: \`${a.selector}\``);
      if (a.component) lines.push(`- React component: \`<${a.component}>\``);
      if (a.elementText) lines.push(`- Text: "${a.elementText}"`);
    } else {
      lines.push(
        `- Area (page px): x=${Math.round(a.rect.x)}, y=${Math.round(a.rect.y)}, w=${Math.round(a.rect.w)}, h=${Math.round(a.rect.h)}`,
      );
      if (a.selectorsInArea?.length) {
        lines.push(`- Contains: ${a.selectorsInArea.map((s) => `\`${s}\``).join(", ")}`);
      }
    }
    lines.push(`- Viewport: ${a.viewport.w}x${a.viewport.h}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
