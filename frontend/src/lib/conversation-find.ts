export interface TextMatch {
  start: number; // match start offset within the text (UTF-16 code units), inclusive
  end: number; // match end offset, exclusive
}

export interface FlatMatch {
  segmentIndex: number; // index into the segmentTexts array passed to collectMatches
  start: number;
  end: number;
}

/**
 * All case-insensitive, accent-sensitive, literal substring matches within one text.
 * Non-overlapping and left-to-right, like a browser find.
 *
 * Case-insensitivity lowercases both text and query. This assumes `toLowerCase()`
 * preserves string length so the lowercased offsets map back to the original text
 * (true for ASCII and accented Latin like "É" -> "é"). Rare length-changing cases
 * (e.g. "İ", ligatures) are out of scope for v1 and intentionally not handled.
 */
export function findMatchesInText(text: string, query: string): TextMatch[] {
  if (!query) return [];

  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const matches: TextMatch[] = [];

  let from = 0;
  for (;;) {
    const start = haystack.indexOf(needle, from);
    if (start === -1) break;
    const end = start + needle.length;
    matches.push({ start, end });
    from = end; // resume after the match so results never overlap
  }

  return matches;
}

/**
 * Run {@link findMatchesInText} over an ordered list of segment texts and flatten the
 * results into one array in document order (segment 0 first, then segment 1, ...).
 */
export function collectMatches(segmentTexts: string[], query: string): FlatMatch[] {
  if (!query) return [];

  const flat: FlatMatch[] = [];
  for (let segmentIndex = 0; segmentIndex < segmentTexts.length; segmentIndex++) {
    for (const match of findMatchesInText(segmentTexts[segmentIndex], query)) {
      flat.push({ segmentIndex, start: match.start, end: match.end });
    }
  }

  return flat;
}

/**
 * Next/previous active-match index with wrap-around.
 * `direction` is 1 for next and -1 for previous. Returns -1 when there are no matches.
 */
export function stepIndex(current: number, total: number, direction: 1 | -1): number {
  if (total === 0) return -1;
  if (current < 0 || current >= total) {
    // No active match (or out of range): start at the appropriate end.
    return direction === 1 ? 0 : total - 1;
  }
  return (current + direction + total) % total;
}

/** Clamp an active index into `[0, total-1]`, or -1 when there are no matches. */
export function clampIndex(index: number, total: number): number {
  if (total === 0) return -1;
  if (index < 0) return 0;
  if (index > total - 1) return total - 1;
  return index;
}
