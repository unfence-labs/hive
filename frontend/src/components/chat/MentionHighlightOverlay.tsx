import { useEffect, useRef, type RefObject } from "react";
import type { FileMention } from "@/types";
import { splitByFileMentions } from "@/lib/file-mentions";

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
  }, [textareaRef, fileMentions.length]);

  if (fileMentions.length === 0) return null;

  const segments = splitByFileMentions(value, fileMentions);
  if (segments.every((s) => !s.mention)) return null;

  return (
    <div
      ref={overlayRef}
      className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-3 py-3 text-sm leading-normal"
      style={{ wordWrap: "break-word" }}
      aria-hidden="true"
    >
      {segments.map((seg, i) =>
        seg.mention ? (
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
