import { cn } from "@/lib/utils";

export type ActivityWaveSize = "small" | "large";

const SIZE_CLASS: Record<ActivityWaveSize, string> = {
  small: "size-3",
  large: "size-4",
};

// Bars share a common bottom (equalizer look) but the whole group is centered
// vertically in the 12x12 viewBox so the glyph aligns with adjacent text/icons.
const BARS = [
  { x: 1, y: 5.5, height: 4, delay: 0 },
  { x: 5, y: 2.5, height: 7, delay: 0.15 },
  { x: 9, y: 4.5, height: 5, delay: 0.3 },
] as const;

interface ActivityWaveProps {
  size?: ActivityWaveSize;
  className?: string;
  label?: string;
  decorative?: boolean;
  durationMs?: number;
}

export function ActivityWave({
  size = "large",
  className,
  label = "Agent thinking",
  decorative = false,
  durationMs = 1200,
}: ActivityWaveProps) {
  return (
    <svg
      viewBox="0 0 12 12"
      className={cn("text-primary", SIZE_CLASS[size], className)}
      fill="none"
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
    >
      {BARS.map((bar) => (
        <rect
          key={bar.x}
          x={bar.x}
          y={bar.y}
          width="2"
          height={bar.height}
          rx="1"
          fill="currentColor"
          className="origin-bottom animate-[hiveWave_1.2s_ease-in-out_infinite]"
          style={{
            animationDelay: `${bar.delay}s`,
            animationDuration: `${durationMs}ms`,
          }}
        />
      ))}
    </svg>
  );
}
