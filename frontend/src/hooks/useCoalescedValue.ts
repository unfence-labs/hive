import { useEffect, useRef, useState } from "react";

/**
 * Returns `value`, but never lets it change more than once per `windowMs`.
 * A change outside the window shows immediately; changes inside the window
 * are held until the window ends, at which point the latest value shows.
 */
export function useCoalescedValue<T>(value: T, windowMs: number): T {
  const [shown, setShown] = useState(value);
  const acceptedAt = useRef(Date.now());
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    if (Object.is(value, shown)) return;
    const elapsed = Date.now() - acceptedAt.current;
    if (elapsed >= windowMs) {
      acceptedAt.current = Date.now();
      setShown(value);
      return;
    }
    const timer = setTimeout(() => {
      acceptedAt.current = Date.now();
      setShown(latest.current);
    }, windowMs - elapsed);
    return () => clearTimeout(timer);
  }, [value, shown, windowMs]);

  return shown;
}
