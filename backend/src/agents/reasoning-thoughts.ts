import type { ReasoningSegment } from "../types.js";
import { stripReasoningSeparators } from "./reasoning-text.js";

/**
 * Split a raw reasoning block into discrete thoughts for the compact log view.
 *
 * Codex summaries arrive as `**headline**` runs, each optionally followed by
 * body text, delimited by `<!-- -->` markers within a single reasoning block.
 * Separators become paragraph breaks, and a bold run is promoted to a headline
 * only at the start of a paragraph (or back-to-back with another headline run,
 * which kills the `****` artifact when two runs collide) — inline `**` inside
 * reasoning prose stays literal body text. This is provider-format
 * normalization, so it lives on the backend and both clients render the
 * resulting thoughts directly.
 */
export function parseReasoningThoughts(content: string, idPrefix: string): ReasoningSegment[] {
  const paragraphs = stripReasoningSeparators(content)
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const thoughts: Array<{ headline?: string; body?: string }> = [];
  let current: { headline?: string; body?: string } | null = null;

  const appendBody = (text: string) => {
    if (current) current.body = current.body ? `${current.body} ${text}` : text;
    else thoughts.push((current = { body: text }));
  };

  for (let paragraph of paragraphs) {
    let match: RegExpExecArray | null;
    while ((match = /^\*\*(.+?)\*\*\s*/.exec(paragraph)) !== null) {
      const headline = match[1].trim();
      // A whitespace-only bold run is formatting junk: consume it, emit nothing.
      if (headline) thoughts.push((current = { headline }));
      paragraph = paragraph.slice(match[0].length);
    }
    if (paragraph) appendBody(paragraph);
  }

  return thoughts.map((thought, index) => ({ id: `${idPrefix}:${index}`, ...thought }));
}
