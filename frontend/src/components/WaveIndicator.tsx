import { cn } from "@/lib/utils";

const BAR_POSITIONS = [1, 3, 5, 7, 9];

export function WaveIndicator({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" className={cn("size-3 text-primary", className)} fill="none">
      {BAR_POSITIONS.map((x, i) => (
        <rect
          key={x}
          x={x}
          width="1.2"
          rx="0.6"
          fill="currentColor"
          className="origin-center animate-[waveBar_1s_ease-in-out_infinite]"
          style={{ animationDelay: `${i * 0.12}s` }}
          y="3"
          height="6"
        />
      ))}
    </svg>
  );
}
