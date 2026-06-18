import { cn } from "@/lib/utils";

/**
 * The Hive brand mark: a rounded "H" with an orange accent pill beneath it.
 * The strokes inherit `currentColor` so the mark adapts to light/dark, while
 * the pill keeps the fixed brand orange. Geometry mirrors public/favicon.svg
 * (the cream tile is dropped so the mark sits on any surface). Size it via
 * `className` (e.g. `h-16 w-auto`); the viewBox is the tight glyph bounds.
 */
export function HiveLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="360 302 304 456"
      fill="none"
      role="img"
      aria-label="Hive"
      className={cn("text-foreground", className)}
    >
      <rect x="370" y="312" width="88" height="394" rx="44" fill="currentColor" />
      <rect x="566" y="312" width="88" height="394" rx="44" fill="currentColor" />
      <rect x="414" y="474" width="196" height="76" rx="38" fill="currentColor" />
      <rect x="474" y="716" width="76" height="32" rx="16" fill="#FF7048" />
    </svg>
  );
}
