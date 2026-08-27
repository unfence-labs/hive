import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
} from "react";
import { flushSync } from "react-dom";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const DISPLAY_DURATION_MS = 5_000;
const EXIT_DURATION_MS = 200;

interface ConversationErrorChipProps {
  message?: string;
  onDismiss: (message: string) => void;
}

export function ConversationErrorChip({ message, onDismiss }: ConversationErrorChipProps) {
  const [displayedMessage, setDisplayedMessage] = useState(message);
  const [isVisible, setIsVisible] = useState(!!message);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);
  const [isPointerOver, setIsPointerOver] = useState(false);
  const [hasFocus, setHasFocus] = useState(false);
  const [isWindowInactive, setIsWindowInactive] = useState(
    () => typeof document !== "undefined" && document.visibilityState === "hidden",
  );
  const remainingMsRef = useRef(DISPLAY_DURATION_MS);
  const messageRef = useRef<HTMLSpanElement>(null);
  const chipRef = useRef<HTMLDivElement>(null);
  const isPointerFocusRef = useRef(false);

  useEffect(() => {
    if (message) {
      setDisplayedMessage(message);
      setIsVisible(true);
      return;
    }

    setIsVisible(false);
    const timeout = window.setTimeout(() => setDisplayedMessage(undefined), EXIT_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [message]);

  useEffect(() => {
    remainingMsRef.current = DISPLAY_DURATION_MS;
    setIsExpanded(false);
  }, [message]);

  useLayoutEffect(() => {
    if (isExpanded) return;
    const element = messageRef.current;
    setIsTruncated(!!element && element.scrollWidth > element.clientWidth);
  }, [displayedMessage, isExpanded]);

  useEffect(() => {
    const updateVisibility = () => setIsWindowInactive(document.visibilityState === "hidden");
    const handleBlur = () => setIsWindowInactive(true);

    document.addEventListener("visibilitychange", updateVisibility);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", updateVisibility);
    return () => {
      document.removeEventListener("visibilitychange", updateVisibility);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", updateVisibility);
    };
  }, []);

  const isPaused = isPointerOver || hasFocus || isWindowInactive || isExpanded;
  useEffect(() => {
    if (!message || isPaused) return;

    const startedAt = performance.now();
    const timeout = window.setTimeout(() => onDismiss(message), remainingMsRef.current);
    return () => {
      window.clearTimeout(timeout);
      remainingMsRef.current = Math.max(
        0,
        remainingMsRef.current - (performance.now() - startedAt),
      );
    };
  }, [isPaused, message, onDismiss]);

  const handleBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setHasFocus(false);
  }, []);

  // FLIP: measure the height around the synchronous re-render, then morph
  // height and border-radius together so the pill-to-card change is one motion.
  // The pill radius is height/2 because rounded-full computes to an
  // un-animatable near-infinite value; the card radius is read from the theme.
  const toggleExpanded = useCallback(() => {
    const chip = chipRef.current;
    const nextExpanded = !isExpanded;
    const fromHeight = chip?.offsetHeight;
    const preRadius = chip ? getComputedStyle(chip).borderRadius : "";
    flushSync(() => setIsExpanded(nextExpanded));
    if (!chip || !fromHeight || typeof chip.animate !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const toHeight = chip.offsetHeight;
    if (toHeight === fromHeight) return;
    const [fromRadius, toRadius] = nextExpanded
      ? [`${fromHeight / 2}px`, getComputedStyle(chip).borderRadius]
      : [preRadius, `${toHeight / 2}px`];
    chip.animate(
      [
        { height: `${fromHeight}px`, borderRadius: fromRadius },
        { height: `${toHeight}px`, borderRadius: toRadius },
      ],
      { duration: 200, easing: "ease-out" },
    );
  }, [isExpanded]);

  if (!displayedMessage) return null;

  const messageText = (
    <span
      ref={messageRef}
      className={cn("block text-sm leading-5", isExpanded ? "break-words" : "truncate")}
    >
      {displayedMessage}
    </span>
  );

  return (
    <div className="pointer-events-none absolute inset-x-0 top-12 z-40 flex justify-center px-4">
      <div
        ref={chipRef}
        role="alert"
        onPointerEnter={() => setIsPointerOver(true)}
        onPointerLeave={() => setIsPointerOver(false)}
        onPointerDownCapture={() => {
          isPointerFocusRef.current = true;
        }}
        onPointerUpCapture={() => {
          isPointerFocusRef.current = false;
        }}
        // Mouse clicks focus buttons (on mousedown) and would pause the
        // auto-dismiss forever; only keyboard-driven focus should pause.
        onFocusCapture={() => {
          if (!isPointerFocusRef.current) setHasFocus(true);
        }}
        onBlurCapture={handleBlur}
        className={cn(
          "pointer-events-auto flex max-w-xl min-w-0 items-start gap-2.5 overflow-hidden border border-background/15 bg-foreground py-2 pr-1.5 pl-3.5 text-background shadow-xl",
          isExpanded ? "rounded-2xl" : "rounded-full",
          // animation-duration (not duration-*) so transition-duration stays 0
          // and no stray "transition: all" fights the expand/collapse morph.
          isVisible
            ? "animate-in fade-in slide-in-from-top-2 [animation-duration:300ms]"
            : "animate-out fade-out slide-out-to-top-2 fill-mode-forwards [animation-duration:200ms]",
          "motion-reduce:animate-none",
        )}
      >
        <span
          aria-hidden="true"
          className="mt-1.5 size-2 shrink-0 rounded-full"
          style={{
            background: "var(--toast-error)",
            boxShadow: "0 0 0 3px color-mix(in oklch, var(--toast-error) 18%, transparent)",
          }}
        />
        {isTruncated || isExpanded ? (
          <button
            type="button"
            aria-expanded={isExpanded}
            onClick={toggleExpanded}
            className="min-w-0 flex-1 cursor-pointer rounded-sm text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-background/40"
          >
            {messageText}
          </button>
        ) : (
          <span className="min-w-0 flex-1">{messageText}</span>
        )}
        <button
          type="button"
          aria-label="Dismiss error"
          onClick={() => onDismiss(displayedMessage)}
          className="-my-1 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-background opacity-60 transition-[background-color,opacity] hover:bg-background/10 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-background/40"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
