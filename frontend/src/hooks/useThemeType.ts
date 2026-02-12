import { useSyncExternalStore } from "react";

function isDark(): boolean {
  return (
    document.documentElement.classList.contains("dark") ||
    (!document.documentElement.classList.contains("light") &&
      window.matchMedia("(prefers-color-scheme: dark)").matches)
  );
}

const subscribers = new Set<() => void>();
let current = isDark();

function notify() {
  const next = isDark();
  if (next !== current) {
    current = next;
    subscribers.forEach((fn) => fn());
  }
}

if (typeof window !== "undefined") {
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", notify);
}

export function useThemeType(): "dark" | "light" {
  return useSyncExternalStore(
    (cb) => {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },
    () => (current ? "dark" : "light"),
  );
}
