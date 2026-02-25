import { useEffect, useMemo, useRef, type RefObject } from "react";
import type { FileMention } from "@/types";
import { AT_MENTION_RE, splitByAllMentions } from "@/lib/file-mentions";

interface MentionHighlightOverlayProps {
  value: string;
  fileMentions: FileMention[];
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

export function MentionHighlightOverlay({
  value,
  fileMentions,
  textareaRef,
}: MentionHighlightOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // Auto-detect @mentions directly from the text
  const atMentions = useMemo(() => {
    const matches = value.match(AT_MENTION_RE);
    return matches ? [...new Set(matches)] : [];
  }, [value]);

  const totalMentions = fileMentions.length + atMentions.length;

  useEffect(() => {
    const textarea = textareaRef.current;
    const overlay = overlayRef.current;
    if (!textarea || !overlay) return;

    const syncScroll = () => {
      overlay.scrollTop = textarea.scrollTop;
      overlay.scrollLeft = textarea.scrollLeft;
    };

    syncScroll();
    textarea.addEventListener("scroll", syncScroll);
    return () => textarea.removeEventListener("scroll", syncScroll);
  }, [textareaRef, totalMentions]);

  if (totalMentions === 0) return null;

  const segments = splitByAllMentions(value, fileMentions, atMentions);
  if (segments.every((s) => !s.highlight)) return null;

  return (
    <div
      ref={overlayRef}
      className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-3 py-3 text-sm leading-normal"
      style={{ wordWrap: "break-word" }}
      aria-hidden="true"
    >
      {segments.map((seg, i) =>
        seg.highlight ? (
          <mark
            key={i}
            className="rounded-sm bg-primary/15 text-transparent"
          >
            {seg.text}
          </mark>
        ) : (
          <span key={i} className="text-transparent">
            {seg.text}
          </span>
        ),
      )}
    </div>
  );
}
