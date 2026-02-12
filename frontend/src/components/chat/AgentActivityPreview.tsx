type Pixel = { x: number; y: number };

export type AgentActivitySize = "large" | "small";

interface LoaderConfig {
  stepPx: number;
  pixelSizePx: number;
  baseOpacity: number;
  timing: (pixel: Pixel) => { delayMs: number; durationMs?: number };
}

function pixelsFromRows(rows: readonly string[]): Pixel[] {
  return rows.flatMap((row, y) =>
    row
      .split("")
      .map((value, x) => ({ value, x, y }))
      .filter((cell) => cell.value === "1")
      .map((cell) => ({ x: cell.x, y: cell.y })),
  );
}

const H_ROWS = ["1001", "1111", "1001"] as const;
const H_PIXELS = pixelsFromRows(H_ROWS);
const H_MAX_X = Math.max(...H_PIXELS.map((pixel) => pixel.x));
const H_MAX_Y = Math.max(...H_PIXELS.map((pixel) => pixel.y));

const LOADER_CONFIG: Record<AgentActivitySize, LoaderConfig> = {
  large: {
    stepPx: 5,
    pixelSizePx: 4,
    baseOpacity: 0.95,
    timing: ({ x, y }) => ({
      delayMs: ((x * 17 + y * 29) % 11) * 95,
      durationMs: 900 + ((x * 19 + y * 13) % 5) * 120,
    }),
  },
  small: {
    stepPx: 4,
    pixelSizePx: 3,
    baseOpacity: 0.88,
    timing: ({ x, y }) => ({
      delayMs: ((x * 13 + y * 31) % 12) * 85,
      durationMs: 980 + ((x * 5 + y * 7) % 5) * 100,
    }),
  },
};

interface AgentActivityPreviewProps {
  size?: AgentActivitySize;
}

export default function AgentActivityPreview({ size = "large" }: AgentActivityPreviewProps) {
  const loader = LOADER_CONFIG[size];
  const width = (H_MAX_X * loader.stepPx) + loader.pixelSizePx;
  const height = (H_MAX_Y * loader.stepPx) + loader.pixelSizePx;

  return (
    <div className="inline-flex items-center">
      <div
        role="img"
        aria-label={`Agent thinking loader ${size}`}
        className="relative"
        style={{ width: `${width}px`, height: `${height}px` }}
      >
        {H_PIXELS.map((pixel) => {
          const timing = loader.timing(pixel);
          return (
            <span
              key={`h-${size}-${pixel.x}-${pixel.y}`}
              className="absolute block rounded-[1px] bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.95)] animate-pixel-thinking-h"
              style={{
                left: `${pixel.x * loader.stepPx}px`,
                top: `${pixel.y * loader.stepPx}px`,
                width: `${loader.pixelSizePx}px`,
                height: `${loader.pixelSizePx}px`,
                opacity: loader.baseOpacity,
                animationDelay: `${(pixel.x * 80) + (pixel.y * 130) + timing.delayMs}ms`,
                animationDuration: timing.durationMs ? `${timing.durationMs}ms` : undefined,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
