import type { FileMention } from "@/types";

export interface MentionChunk {
  text: string;
  mention?: FileMention;
}

export function splitByFileMentions(content: string, mentions: FileMention[] | undefined): MentionChunk[] {
  if (!mentions?.length) return [{ text: content }];

  const chunks: MentionChunk[] = [];
  let cursor = 0;

  while (cursor < content.length) {
    let nextIndex = -1;
    let nextMention: FileMention | undefined;

    for (const mention of mentions) {
      const needle = `#${mention.displayName}`;
      const idx = content.indexOf(needle, cursor);
      if (idx === -1) continue;

      if (
        nextIndex === -1
        || idx < nextIndex
        || (idx === nextIndex && nextMention && needle.length > `#${nextMention.displayName}`.length)
      ) {
        nextIndex = idx;
        nextMention = mention;
      }
    }

    if (nextIndex === -1 || !nextMention) {
      chunks.push({ text: content.slice(cursor) });
      break;
    }

    if (nextIndex > cursor) {
      chunks.push({ text: content.slice(cursor, nextIndex) });
    }

    const mentionText = `#${nextMention.displayName}`;
    chunks.push({ text: mentionText, mention: nextMention });
    cursor = nextIndex + mentionText.length;
  }

  return chunks.length > 0 ? chunks : [{ text: content }];
}
