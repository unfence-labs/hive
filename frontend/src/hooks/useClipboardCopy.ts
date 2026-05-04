import { useCallback, useEffect, useRef, useState } from "react";
import { copyToClipboard } from "@/lib/clipboard";

export function useClipboardCopy(resetDelayMs = 2000) {
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearResetTimer = useCallback(() => {
    if (!resetTimerRef.current) return;
    clearTimeout(resetTimerRef.current);
    resetTimerRef.current = null;
  }, []);

  useEffect(() => clearResetTimer, [clearResetTimer]);

  const copy = useCallback(async (value: string) => {
    await copyToClipboard(value);
    setCopiedValue(value);

    clearResetTimer();
    resetTimerRef.current = setTimeout(() => {
      setCopiedValue((current) => (current === value ? null : current));
      resetTimerRef.current = null;
    }, resetDelayMs);
  }, [clearResetTimer, resetDelayMs]);

  const isCopied = useCallback(
    (value: string) => copiedValue === value,
    [copiedValue],
  );

  return { copiedValue, copy, isCopied };
}
