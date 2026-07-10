/**
 * Codex separates reasoning summary parts with `<!-- -->` HTML comments,
 * streamed token-split across deltas (`<!--` and ` -->` arrive separately).
 * These helpers normalize the markers to paragraph breaks so they never
 * reach clients or stored reasoning content.
 */

const SEPARATOR = /\s*<!--\s*-->\s*/g;

// Longest tail of a streamed chunk that could still grow into a separator
// once the next delta arrives: trailing whitespace, optionally followed by a
// partial `<!--`, optional inner whitespace, and a partial `-->`.
const PARTIAL_SEPARATOR_TAIL = /\s*(?:<(?:!(?:-(?:-(?:\s*(?:-(?:-)?)?)?)?)?)?)?$/;

/** Replace complete separators with paragraph breaks. */
export function stripReasoningSeparators(text: string): string {
  return text.replace(SEPARATOR, "\n\n");
}

/** Normalize finalized reasoning content: strip separators, trim the tail. */
export function cleanReasoningText(text: string): string {
  return stripReasoningSeparators(text).trimEnd();
}

/**
 * Split streamed reasoning text into an emittable head and a tail to hold
 * back until the next delta disambiguates it (a partial separator completes
 * and is dropped, or turns out to be regular text and is emitted).
 */
export function splitPendingSeparatorTail(text: string): { emit: string; hold: string } {
  const hold = PARTIAL_SEPARATOR_TAIL.exec(text)?.[0] ?? "";
  return { emit: text.slice(0, text.length - hold.length), hold };
}
