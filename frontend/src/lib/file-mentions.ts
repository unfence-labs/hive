import type { FileMention } from "@/types";

/** Match @mention tokens: must start after whitespace or beginning of string. */
export const AT_MENTION_RE = /(?:^|(?<=\s))@[\w][\w-]*/g;

export interface MentionChunk {
  text: string;
  mention?: FileMention;
  highlight?: boolean;
}

interface HighlightTarget {
  needle: string;
  mention?: FileMention;
}

function splitByTargets(content: string, targets: HighlightTarget[]): MentionChunk[] {
  if (targets.length === 0) return [{ text: content }];

  const chunks: MentionChunk[] = [];
  let cursor = 0;

  while (cursor < content.length) {
    let bestIndex = -1;
    let bestTarget: HighlightTarget | undefined;

    for (const target of targets) {
      const idx = content.indexOf(target.needle, cursor);
      if (idx === -1) continue;

      if (
        bestIndex === -1
        || idx < bestIndex
        || (idx === bestIndex && bestTarget && target.needle.length > bestTarget.needle.length)
      ) {
        bestIndex = idx;
        bestTarget = target;
      }
    }

    if (bestIndex === -1 || !bestTarget) {
      chunks.push({ text: content.slice(cursor) });
      break;
    }

    if (bestIndex > cursor) {
      chunks.push({ text: content.slice(cursor, bestIndex) });
    }

    chunks.push({ text: bestTarget.needle, mention: bestTarget.mention, highlight: true });
    cursor = bestIndex + bestTarget.needle.length;
  }

  return chunks.length > 0 ? chunks : [{ text: content }];
}

export function splitByAllMentions(
  content: string,
  fileMentions: FileMention[] | undefined,
  agentMentions: string[] | undefined,
): MentionChunk[] {
  const targets: HighlightTarget[] = [
    ...(fileMentions ?? []).map((m) => ({ needle: `#${m.displayName}`, mention: m })),
    ...(agentMentions ?? []).map((name) => ({ needle: name })),
  ];
  return splitByTargets(content, targets);
}
