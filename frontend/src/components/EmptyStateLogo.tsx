import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateLogoProps {
  className?: string;
}

const CELL_SIZE = 8;
const MORPH_START = 80;
const MORPH_END = 220;
const PALETTE = {
  bg: "#09090f",
  dim: "#1a472a",
  mid: "#2d8b46",
  bright: "#5ce65c",
  hot: "#aaffaa",
};

function startAnimation(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
) {
  ctx.imageSmoothingEnabled = false;

  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  let W: number, H: number, cols: number, rows: number;
  let targetGrid: number[][];
  let grid: number[][];
  let age: number[][];
  let frame = 0;
  let animId = 0;

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
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, W, H);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!targetGrid[r][c]) continue;
        ctx.fillStyle = PALETTE.bright;
        ctx.fillRect(
          c * CELL_SIZE,
          r * CELL_SIZE,
          CELL_SIZE - 1,
          CELL_SIZE - 1,
        );
        ctx.fillStyle = PALETTE.hot;
        ctx.fillRect(c * CELL_SIZE, r * CELL_SIZE, 2, 2);
      }
    }
  }

  function draw() {
    ctx.fillStyle = PALETTE.bg;
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
          ctx.fillStyle = intensity > 0.5 ? PALETTE.hot : PALETTE.bright;
          ctx.fillRect(x, y, CELL_SIZE - 1, CELL_SIZE - 1);
          ctx.fillStyle = PALETTE.hot;
          ctx.fillRect(x, y, 2, 2);
        } else {
          ctx.fillStyle = a > 3 ? PALETTE.mid : PALETTE.dim;
          ctx.fillRect(x, y, CELL_SIZE - 1, CELL_SIZE - 1);
        }
      }
    }

    if (morphProgress > 0.8) {
      ctx.strokeStyle = "rgba(90, 230, 90, 0.04)";
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

    if (prefersReducedMotion) {
      drawStatic();
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

export default function EmptyStateLogo({ className }: EmptyStateLogoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    return startAnimation(canvas, ctx);
  }, []);

  return (
    <div
      className={cn("h-full w-full", className)}
      style={{ background: PALETTE.bg }}
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        style={{ imageRendering: "pixelated" }}
      />
    </div>
  );
}
