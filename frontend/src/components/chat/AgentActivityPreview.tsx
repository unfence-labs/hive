type Pixel = { x: number; y: number };

export type AgentActivitySize = "large" | "small";

interface LoaderConfig {
  stepPx: number;
  pixelSizePx: number;
  baseOpacity: number;
  timing: (pixel: Pixel) => { delayMs: number; durationMs?: number };
}

function pixelsFromRows(rows: string[]): Pixel[] {
  return rows.flatMap((row, y) =>
    row
      .split("")
      .map((value, x) => ({ value, x, y }))
      .filter((cell) => cell.value === "1")
      .map((cell) => ({ x: cell.x, y: cell.y })),
  );
}

const V1_PIXELS = pixelsFromRows(["11111", "11111"]);
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
  const maxX = Math.max(...V1_PIXELS.map((pixel) => pixel.x));
  const maxY = Math.max(...V1_PIXELS.map((pixel) => pixel.y));
  const width = (maxX * loader.stepPx) + loader.pixelSizePx;
  const height = (maxY * loader.stepPx) + loader.pixelSizePx;

  return (
    <div className="mb-3 flex items-center">
      <div
        role="img"
        aria-label={`Agent running loader ${size}`}
        className="relative"
        style={{ width: `${width}px`, height: `${height}px` }}
      >
        {V1_PIXELS.map((pixel) => {
          const timing = loader.timing(pixel);
          return (
            <span
              key={`rnd-${size}-${pixel.x}-${pixel.y}`}
              className="absolute block rounded-[1px] bg-emerald-300 shadow-[0_0_6px_rgba(74,222,128,0.9)] animate-pixel-blink-random"
              style={{
                left: `${pixel.x * loader.stepPx}px`,
                top: `${pixel.y * loader.stepPx}px`,
                width: `${loader.pixelSizePx}px`,
                height: `${loader.pixelSizePx}px`,
                opacity: loader.baseOpacity,
                animationDelay: `${timing.delayMs}ms`,
                animationDuration: timing.durationMs ? `${timing.durationMs}ms` : undefined,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
