import { useEffect, useRef, useState } from "react";
import { FolderGit2, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateLogoProps {
  className?: string;
  onAddProject?: () => void;
}

const CELL_SIZE = 8;
const MORPH_START = 80;
const MORPH_END = 220;
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
    dim: rgbToHex(r * 0.2, g * 0.2, b * 0.2),
    mid: rgbToHex(r * 0.45, g * 0.45, b * 0.45),
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

function startAnimation(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  onDone: () => void,
) {
  ctx.imageSmoothingEnabled = false;

  const accent = getAccentHex();
  const palette = buildPalette(accent);
  const [acR, acG, acB] = hexToRgb(accent);

  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  let W: number, H: number, cols: number, rows: number;
  let targetGrid: number[][];
  let grid: number[][];
  let age: number[][];
  let frame = 0;
  let animId = 0;
  let doneFired = false;

  function buildMask() {
    const off = document.createElement("canvas");
    off.width = W;
    off.height = H;
    const octx = off.getContext("2d")!;
    octx.fillStyle = "#fff";
    octx.font = `bold ${Math.min(W * 0.18, 160)}px monospace`;
    octx.textAlign = "center";
    octx.textBaseline = "middle";
    octx.fillText("HIVE", W / 2, H / 2);
    const data = octx.getImageData(0, 0, W, H).data;

    return Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => {
        const px = c * CELL_SIZE + CELL_SIZE / 2;
        const py = r * CELL_SIZE + CELL_SIZE / 2;
        return data[(Math.floor(py) * W + Math.floor(px)) * 4 + 3] > 128
          ? 1
          : 0;
      }),
    );
  }

  function countNeighbors(g: number[][], r: number, c: number) {
    let count = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        count += g[(r + dr + rows) % rows][(c + dc + cols) % cols];
      }
    }
    return count;
  }

  function step() {
    const next = Array.from({ length: rows }, () =>
      new Array<number>(cols).fill(0),
    );
    const nextAge = Array.from({ length: rows }, () =>
      new Array<number>(cols).fill(0),
    );
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const n = countNeighbors(grid, r, c);
        if (grid[r][c]) {
          next[r][c] = n === 2 || n === 3 ? 1 : 0;
          if (next[r][c]) nextAge[r][c] = age[r][c] + 1;
        } else {
          next[r][c] = n === 3 ? 1 : 0;
        }
      }
    }
    age = nextAge;
    return next;
  }

  function drawStatic() {
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, W, H);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!targetGrid[r][c]) continue;
        ctx.fillStyle = palette.bright;
        ctx.fillRect(
          c * CELL_SIZE,
          r * CELL_SIZE,
          CELL_SIZE - 1,
          CELL_SIZE - 1,
        );
        ctx.fillStyle = palette.hot;
        ctx.fillRect(c * CELL_SIZE, r * CELL_SIZE, 2, 2);
      }
    }
  }

  function draw() {
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, W, H);
    frame++;

    if (frame < MORPH_START) {
      grid = step();
      if (frame % 8 === 0) {
        for (let i = 0; i < 60; i++) {
          grid[(Math.random() * rows) | 0][(Math.random() * cols) | 0] = 1;
        }
      }
    } else {
      const progress = Math.min(
        (frame - MORPH_START) / (MORPH_END - MORPH_START),
        1,
      );
      grid = step();
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (Math.random() < progress * 0.12) {
            grid[r][c] = targetGrid[r][c];
          }
        }
      }
    }

    const morphProgress = Math.min(
      Math.max((frame - MORPH_START) / (MORPH_END - MORPH_START), 0),
      1,
    );

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!grid[r][c]) continue;

        const isTarget = targetGrid[r][c];
        const x = c * CELL_SIZE;
        const y = r * CELL_SIZE;
        const a = age[r][c];

        if (isTarget && morphProgress > 0.4) {
          const intensity = Math.min(a, 10) / 10;
          ctx.fillStyle = intensity > 0.5 ? palette.hot : palette.bright;
          ctx.fillRect(x, y, CELL_SIZE - 1, CELL_SIZE - 1);
          ctx.fillStyle = palette.hot;
          ctx.fillRect(x, y, 2, 2);
        } else {
          ctx.fillStyle = a > 3 ? palette.mid : palette.dim;
          ctx.fillRect(x, y, CELL_SIZE - 1, CELL_SIZE - 1);
        }
      }
    }

    if (morphProgress >= 1 && !doneFired) {
      doneFired = true;
      onDone();
    }

    if (morphProgress > 0.8) {
      ctx.strokeStyle = `rgba(${acR}, ${acG}, ${acB}, 0.04)`;
      ctx.lineWidth = 0.5;
      for (let x = 0; x < W; x += CELL_SIZE) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
      for (let y = 0; y < H; y += CELL_SIZE) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
    }

    animId = requestAnimationFrame(draw);
  }

  function init() {
    const parent = canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    W = canvas.width = rect.width;
    H = canvas.height = rect.height;
    cols = Math.floor(W / CELL_SIZE);
    rows = Math.floor(H / CELL_SIZE);
    targetGrid = buildMask();
    grid = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => (Math.random() < 0.18 ? 1 : 0)),
    );
    age = Array.from({ length: rows }, () =>
      new Array<number>(cols).fill(0),
    );
    frame = 0;

    doneFired = false;

    if (prefersReducedMotion) {
      drawStatic();
      onDone();
    } else {
      cancelAnimationFrame(animId);
      draw();
    }
  }

  init();

  const ro = new ResizeObserver(() => init());
  if (canvas.parentElement) ro.observe(canvas.parentElement);

  return () => {
    cancelAnimationFrame(animId);
    ro.disconnect();
  };
}

export default function EmptyStateLogo({
  className,
  onAddProject,
}: EmptyStateLogoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [showButtons, setShowButtons] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    return startAnimation(canvas, ctx, () => setShowButtons(true));
  }, []);

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
      <div
        className={cn(
          "absolute inset-x-0 bottom-[28%] flex items-center justify-center gap-3 transition-opacity duration-700",
          showButtons ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <button
          type="button"
          onClick={onAddProject}
          className="flex cursor-pointer items-center gap-2 rounded border border-primary/30 bg-background px-5 py-2.5 font-mono text-sm text-primary transition-colors duration-200 hover:border-primary/60 hover:bg-primary/5 focus:outline-none focus:ring-1 focus:ring-primary/50"
        >
          <FolderGit2 size={16} />
          Add repository
        </button>
        <a
          href="https://docs.hive.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="flex cursor-pointer items-center gap-2 rounded border border-border bg-background px-5 py-2.5 font-mono text-sm text-muted-foreground transition-colors duration-200 hover:border-border/80 hover:bg-muted/10 hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring/30"
        >
          <BookOpen size={16} />
          Documentation
        </a>
      </div>
    </div>
  );
}
