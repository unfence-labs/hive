import { useCallback, useEffect, useRef, useState, type FocusEvent } from "react";
import { CircleAlertIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const DISPLAY_DURATION_MS = 5_000;
const EXIT_DURATION_MS = 180;

interface ConversationErrorChipProps {
  message?: string;
  onDismiss: (message: string) => void;
}

export function ConversationErrorChip({ message, onDismiss }: ConversationErrorChipProps) {
  const [displayedMessage, setDisplayedMessage] = useState(message);
  const [isVisible, setIsVisible] = useState(!!message);
  const [isPointerOver, setIsPointerOver] = useState(false);
  const [hasFocus, setHasFocus] = useState(false);
  const [isWindowInactive, setIsWindowInactive] = useState(
    () => typeof document !== "undefined" && document.visibilityState === "hidden",
  );
  const remainingMsRef = useRef(DISPLAY_DURATION_MS);

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
  }, [message]);

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

  const isPaused = isPointerOver || hasFocus || isWindowInactive;
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

  if (!displayedMessage) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-12 z-40 flex justify-center px-4">
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              role="alert"
              tabIndex={0}
              onPointerEnter={() => setIsPointerOver(true)}
              onPointerLeave={() => setIsPointerOver(false)}
              onFocusCapture={() => setHasFocus(true)}
              onBlurCapture={handleBlur}
              className={cn(
                "pointer-events-auto flex max-w-xl min-w-0 items-start gap-2 rounded-lg bg-destructive px-3 py-2 text-destructive-foreground shadow-lg",
                "transition-[opacity,transform] duration-200 ease-out focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-destructive/30",
                "motion-reduce:transform-none motion-reduce:transition-none",
                isVisible ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0",
              )}
            >
              <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span className="line-clamp-2 min-w-0 flex-1 break-words text-sm leading-5">
                {displayedMessage}
              </span>
              <button
                type="button"
                aria-label="Dismiss error"
                onClick={() => onDismiss(displayedMessage)}
                className="-m-1 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded text-destructive-foreground/70 transition-colors hover:bg-destructive-foreground/10 hover:text-destructive-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-destructive-foreground/40"
              >
                <XIcon className="size-3.5" />
              </button>
            </div>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            sideOffset={6}
            className="max-w-[min(36rem,calc(100vw-2rem))] break-words text-left"
          >
            {displayedMessage}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
