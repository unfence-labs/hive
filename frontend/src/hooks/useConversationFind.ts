import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { collectMatches, stepIndex, clampIndex } from "@/lib/conversation-find";
import { useAppCommand } from "@/hooks/useAppCommand";

const FIND_HIGHLIGHT = "conversation-find";
const FIND_ACTIVE_HIGHLIGHT = "conversation-find-active";
const FIND_CONTENT_SELECTOR = "[data-find-content]";
const REINDEX_DEBOUNCE_MS = 150;
const MAX_PREFILL_LENGTH = 200;

/**
 * The CSS Custom Highlight API paints matches without mutating the DOM, which is
 * why we can highlight Streamdown-rendered content safely. Older engines without
 * it simply skip painting (the counter and navigation still work); per product
 * decision we do not ship a `<mark>`-wrapping fallback.
 */
const highlightsSupported =
  typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";

/** A text node and where its text sits within its parent segment string. */
interface SegmentNode {
  node: Text;
  start: number;
  length: number;
}

/** Map an absolute offset within a segment back to a (text node, node offset). */
function locate(nodes: SegmentNode[], offset: number): { node: Text; offset: number } | null {
  for (const entry of nodes) {
    if (offset >= entry.start && offset <= entry.start + entry.length) {
      return { node: entry.node, offset: offset - entry.start };
    }
  }
  return null;
}

export interface UseConversationFindOptions {
  /** The conversation scroll container; matches are searched and scrolled within it. */
  scrollRef: RefObject<HTMLElement | null>;
  /** Changing this (conversation/session switch) closes the bar and clears highlights. */
  switchCounter: number;
}

export interface UseConversationFindResult {
  open: boolean;
  query: string;
  matchCount: number;
  /** 0-based index of the active match, or -1 when there are no matches. */
  activeIndex: number;
  /** True only after a completed search for the current query found nothing. */
  noResults: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  setQuery: (value: string) => void;
  next: () => void;
  prev: () => void;
  close: () => void;
}

/**
 * Find-in-conversation behaviour: owns the Cmd/Ctrl+F shortcut, the match index,
 * and the CSS Custom Highlight API painting. Pure matching/navigation arithmetic
 * lives in `lib/conversation-find`; this hook is the thin DOM glue around it.
 */
export function useConversationFind({
  scrollRef,
  switchCounter,
}: UseConversationFindOptions): UseConversationFindResult {
  const [open, setOpen] = useState(false);
  const [query, setQueryState] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  // The query whose results are currently reflected in matchCount. Kept distinct
  // from `query` so the "no results" state only shows after a search has actually
  // run — not during the debounce window, which would flash red prematurely.
  const [indexedQuery, setIndexedQuery] = useState("");

  const inputRef = useRef<HTMLInputElement | null>(null);
  const rangesRef = useRef<Range[]>([]);
  const queryRef = useRef(query);
  const openRef = useRef(open);
  const activeIndexRef = useRef(activeIndex);
  const debounceRef = useRef<number | null>(null);
  openRef.current = open;
  activeIndexRef.current = activeIndex;

  const clearHighlights = useCallback(() => {
    if (!highlightsSupported) return;
    CSS.highlights.delete(FIND_HIGHLIGHT);
    CSS.highlights.delete(FIND_ACTIVE_HIGHLIGHT);
  }, []);

  // Build a fresh Range for every match by walking the tagged content regions.
  const buildRanges = useCallback(
    (q: string): Range[] => {
      const el = scrollRef.current;
      if (!el || !q) return [];

      const segmentEls = Array.from(el.querySelectorAll<HTMLElement>(FIND_CONTENT_SELECTOR));
      const segmentTexts: string[] = [];
      const segmentNodes: SegmentNode[][] = [];

      for (const segmentEl of segmentEls) {
        const walker = document.createTreeWalker(segmentEl, NodeFilter.SHOW_TEXT);
        let text = "";
        const nodes: SegmentNode[] = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const value = node.nodeValue ?? "";
          if (value.length === 0) continue;
          nodes.push({ node: node as Text, start: text.length, length: value.length });
          text += value;
        }
        segmentTexts.push(text);
        segmentNodes.push(nodes);
      }

      const ranges: Range[] = [];
      for (const match of collectMatches(segmentTexts, q)) {
        const nodes = segmentNodes[match.segmentIndex];
        const startPos = locate(nodes, match.start);
        const endPos = locate(nodes, match.end);
        if (!startPos || !endPos) continue;
        const range = document.createRange();
        range.setStart(startPos.node, startPos.offset);
        range.setEnd(endPos.node, endPos.offset);
        ranges.push(range);
      }
      return ranges;
    },
    [scrollRef],
  );

  // Paint the active match distinctly and scroll it into view (centered).
  const paintActive = useCallback(() => {
    const ranges = rangesRef.current;
    const index = activeIndexRef.current;
    const active = index >= 0 && index < ranges.length ? ranges[index] : null;

    if (highlightsSupported) {
      if (active) CSS.highlights.set(FIND_ACTIVE_HIGHLIGHT, new Highlight(active));
      else CSS.highlights.delete(FIND_ACTIVE_HIGHLIGHT);
    }

    const el = scrollRef.current;
    if (!el || !active) return;
    const rect = active.getBoundingClientRect();
    // jsdom and pre-layout states return zero-sized rects; skip scrolling then.
    if (rect.height === 0 && rect.width === 0) return;
    const containerRect = el.getBoundingClientRect();
    const target = el.scrollTop + (rect.top - containerRect.top) - el.clientHeight / 2 + rect.height / 2;
    el.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }, [scrollRef]);

  const reindex = useCallback(
    (reason: "query" | "content") => {
      const ranges = buildRanges(queryRef.current);
      rangesRef.current = ranges;
      setMatchCount(ranges.length);
      setIndexedQuery(queryRef.current);

      if (highlightsSupported) {
        if (ranges.length > 0) CSS.highlights.set(FIND_HIGHLIGHT, new Highlight(...ranges));
        else CSS.highlights.delete(FIND_HIGHLIGHT);
      }

      setActiveIndex((prev) => {
        if (ranges.length === 0) return -1;
        // A new query jumps to the first match; a content change keeps position.
        return reason === "query" ? 0 : clampIndex(prev < 0 ? 0 : prev, ranges.length);
      });
    },
    [buildRanges],
  );

  const scheduleReindex = useCallback(
    (reason: "query" | "content") => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = null;
        reindex(reason);
      }, REINDEX_DEBOUNCE_MS);
    },
    [reindex],
  );

  const setQuery = useCallback((value: string) => setQueryState(value), []);

  const next = useCallback(() => {
    setActiveIndex((prev) => stepIndex(prev, rangesRef.current.length, 1));
  }, []);

  const prev = useCallback(() => {
    setActiveIndex((p) => stepIndex(p, rangesRef.current.length, -1));
  }, []);

  const close = useCallback(() => {
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setOpen(false);
    setMatchCount(0);
    setActiveIndex(-1);
    setIndexedQuery("");
    rangesRef.current = [];
    clearHighlights();
  }, [clearHighlights]);

  const openAndFocus = useCallback(() => {
    if (!scrollRef.current) return;
    const wasOpen = openRef.current;
    setOpen(true);
    if (!wasOpen) {
      const selection = window.getSelection()?.toString() ?? "";
      if (selection && selection.length <= MAX_PREFILL_LENGTH && !selection.includes("\n")) {
        setQueryState(selection);
      }
    }
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [scrollRef]);

  const findNext = useCallback(() => {
    if (openRef.current) next();
    else openAndFocus();
  }, [next, openAndFocus]);

  const findPrevious = useCallback(() => {
    if (openRef.current) prev();
    else openAndFocus();
  }, [prev, openAndFocus]);

  useAppCommand("find-next", findNext);
  useAppCommand("find-previous", findPrevious);

  // Re-index (debounced) whenever the query changes while the bar is open.
  useEffect(() => {
    queryRef.current = query;
    if (!open) return;
    scheduleReindex("query");
  }, [query, open, scheduleReindex]);

  // Re-index (debounced) when the conversation content mutates (streaming, new
  // messages) so counts and highlights stay accurate.
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (!el) return;
    const observer = new MutationObserver(() => scheduleReindex("content"));
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [open, scrollRef, scheduleReindex]);

  // Repaint the active match whenever the index or the match set changes.
  useEffect(() => {
    if (!open) return;
    paintActive();
  }, [open, activeIndex, matchCount, paintActive]);

  // Global Cmd/Ctrl+F: open (or refocus) the bar and suppress native find.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (e.key !== "f" && e.key !== "F") return;
      if (!scrollRef.current) return;
      e.preventDefault();
      openAndFocus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openAndFocus, scrollRef]);

  // Conversation/session switch: reset everything.
  useEffect(() => {
    close();
    setQueryState("");
  }, [switchCounter, close]);

  // Clear highlights and any pending work on unmount.
  useEffect(() => {
    return () => {
      clearHighlights();
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [clearHighlights]);

  const noResults = query !== "" && indexedQuery === query && matchCount === 0;

  return { open, query, matchCount, activeIndex, noResults, inputRef, setQuery, next, prev, close };
}
