import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { FolderGit2, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTailscaleConfig } from "@/hooks/useTailscaleConfig";

interface EmptyStateLogoProps {
  className?: string;
  onAddProject?: () => void;
  enableAnimation?: boolean;
}

const CELL_SIZE = 8;
const BG = "#09090f";

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function buildPalette(accent: string) {
  const [r, g, b] = hexToRgb(accent);
  return {
    bg: BG,
    bright: rgbToHex(r * 0.8, g * 0.8, b * 0.8),
    hot: rgbToHex(
      r + (255 - r) * 0.45,
      g + (255 - g) * 0.45,
      b + (255 - b) * 0.45,
    ),
  };
}

function getAccentHex(): string {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--hive-accent")
    .trim();
  return raw || "#7c3aed";
}

function renderStaticLogo(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
) {
  ctx.imageSmoothingEnabled = false;
  let resizeRafId = 0;

  function draw() {
    const parent = canvas.parentElement;
    if (!parent) return;

    const rect = parent.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));

    canvas.width = width;
    canvas.height = height;

    const cols = Math.max(1, Math.floor(width / CELL_SIZE));
    const rows = Math.max(1, Math.floor(height / CELL_SIZE));

    const accent = getAccentHex();
    const palette = buildPalette(accent);
    const [acR, acG, acB] = hexToRgb(accent);

    const off = document.createElement("canvas");
    off.width = width;
    off.height = height;
    const octx = off.getContext("2d");
    if (!octx) return;

    octx.fillStyle = "#fff";
    octx.font = `bold ${Math.min(width * 0.18, 160)}px monospace`;
    octx.textAlign = "center";
    octx.textBaseline = "middle";
    octx.fillText("HIVE", width / 2, height / 2);
    const data = octx.getImageData(0, 0, width, height).data;

    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, width, height);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const px = Math.min(width - 1, (c * CELL_SIZE + CELL_SIZE / 2) | 0);
        const py = Math.min(height - 1, (r * CELL_SIZE + CELL_SIZE / 2) | 0);
        const isTarget = data[(py * width + px) * 4 + 3] > 128;
        if (!isTarget) continue;

        const x = c * CELL_SIZE;
        const y = r * CELL_SIZE;
        ctx.fillStyle = palette.bright;
        ctx.fillRect(x, y, CELL_SIZE - 1, CELL_SIZE - 1);
        ctx.fillStyle = palette.hot;
        ctx.fillRect(x, y, 2, 2);
      }
    }

    ctx.strokeStyle = `rgba(${acR}, ${acG}, ${acB}, 0.04)`;
    ctx.lineWidth = 0.5;
    for (let x = 0; x < width; x += CELL_SIZE) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += CELL_SIZE) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }

  function scheduleDraw() {
    if (resizeRafId) return;
    resizeRafId = requestAnimationFrame(() => {
      resizeRafId = 0;
      draw();
    });
  }

  draw();

  const ro = new ResizeObserver(scheduleDraw);
  if (canvas.parentElement) ro.observe(canvas.parentElement);

  return () => {
    cancelAnimationFrame(resizeRafId);
    ro.disconnect();
  };
}

function renderLogo(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  enableAnimation: boolean,
) {
  if (enableAnimation) {
    // Animation path intentionally disabled for now due to perf concerns.
    return renderStaticLogo(canvas, ctx);
  }

  return renderStaticLogo(canvas, ctx);
}

export default function EmptyStateLogo({
  className,
  onAddProject,
  enableAnimation = false,
}: EmptyStateLogoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { isConfigured } = useTailscaleConfig();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    return renderLogo(canvas, ctx, enableAnimation);
  }, [enableAnimation]);

  return (
    <div
      className={cn("relative h-full w-full", className)}
      style={{ background: BG }}
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        style={{ imageRendering: "pixelated" }}
      />
      <div className="absolute inset-x-0 bottom-[28%] flex flex-col items-center gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onAddProject}
            disabled={!isConfigured}
            className={cn(
              "flex items-center gap-2 rounded-md border px-5 py-2.5 font-mono text-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-transparent",
              isConfigured
                ? "cursor-pointer border-primary/40 bg-primary/10 text-primary hover:border-primary/70 hover:bg-primary/20 focus:ring-primary/40"
                : "cursor-not-allowed border-border/30 bg-muted/5 text-muted-foreground/30",
            )}
          >
            <FolderGit2 size={15} />
            Add repository
          </button>
          <Link
            to="/settings"
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-md border px-5 py-2.5 font-mono text-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-transparent",
              isConfigured
                ? "border-border bg-background text-muted-foreground hover:border-border/80 hover:bg-muted/10 hover:text-foreground focus:ring-ring/30"
                : "border-primary/50 bg-primary/15 text-primary hover:border-primary hover:bg-primary/25 focus:ring-primary/40",
            )}
          >
            <Settings size={15} />
            Start config
          </Link>
        </div>
        <a
          href="https://docs.hive.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-muted-foreground/40 transition-colors hover:text-muted-foreground/70"
        >
          Documentation
        </a>
      </div>
    </div>
  );
}
