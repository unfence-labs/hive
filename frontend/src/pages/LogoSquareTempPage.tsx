import { useEffect, useRef, useState } from "react";

const CELL_SIZE = 8;
const BG = "#09090f";

interface LogoGrid {
  cols: number;
  rows: number;
  cells: Uint8Array;
  width: number;
  height: number;
}

interface RenderedLogo {
  accentRgb: [number, number, number];
  palette: ReturnType<typeof buildPalette>;
  grid: LogoGrid;
}

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

function buildSquareMask(width: number, height: number): LogoGrid {
  const cols = Math.max(1, Math.floor(width / CELL_SIZE));
  const rows = Math.max(1, Math.floor(height / CELL_SIZE));
  const cellCount = cols * rows;
  const cells = new Uint8Array(cellCount);
  const off = document.createElement("canvas");
  off.width = width;
  off.height = height;
  const octx = off.getContext("2d");

  if (!octx) {
    return { cols, rows, cells, width, height };
  }

  const fontSize = Math.min(width, height) * 0.9;
  octx.fillStyle = "#fff";
  octx.font = `bold ${fontSize}px "Geist Pixel Square", "Geist Mono", monospace`;
  octx.textAlign = "left";
  octx.textBaseline = "alphabetic";
  const glyph = "H";
  const metrics = octx.measureText(glyph);
  const x = width / 2 - (metrics.actualBoundingBoxRight - metrics.actualBoundingBoxLeft) / 2;
  const y = height / 2 + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
  octx.fillText(glyph, x, y);

  const data = octx.getImageData(0, 0, width, height).data;
  let idx = 0;

  for (let r = 0; r < rows; r++) {
    const py = Math.min(height - 1, (r * CELL_SIZE + CELL_SIZE / 2) | 0);
    for (let c = 0; c < cols; c++) {
      const px = Math.min(width - 1, (c * CELL_SIZE + CELL_SIZE / 2) | 0);
      cells[idx] = data[(py * width + px) * 4 + 3] > 128 ? 1 : 0;
      idx++;
    }
  }

  return { cols, rows, cells, width, height };
}

function drawGridOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  accentRgb: [number, number, number],
) {
  const [r, g, b] = accentRgb;
  ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.04)`;
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

function renderSquareLogo(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
): RenderedLogo {
  const accent = getAccentHex();
  const accentRgb = hexToRgb(accent);
  const palette = buildPalette(accent);
  const width = Math.max(1, Math.floor(canvas.clientWidth));
  const height = Math.max(1, Math.floor(canvas.clientHeight));
  canvas.width = width;
  canvas.height = height;

  const grid = buildSquareMask(width, height);

  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, width, height);

  let idx = 0;
  for (let r = 0; r < grid.rows; r++) {
    const y = r * CELL_SIZE;
    for (let c = 0; c < grid.cols; c++) {
      if (grid.cells[idx]) {
        const x = c * CELL_SIZE;
        ctx.fillStyle = palette.bright;
        ctx.fillRect(x, y, CELL_SIZE - 1, CELL_SIZE - 1);
        ctx.fillStyle = palette.hot;
        ctx.fillRect(x, y, 2, 2);
      }
      idx++;
    }
  }

  drawGridOverlay(ctx, width, height, accentRgb);

  return { accentRgb, palette, grid };
}

function buildSvgMarkup(logo: RenderedLogo): string {
  const { grid, palette, accentRgb } = logo;
  const [r, g, b] = accentRgb;
  const cells: string[] = [];
  let idx = 0;

  for (let row = 0; row < grid.rows; row++) {
    const y = row * CELL_SIZE;
    for (let col = 0; col < grid.cols; col++) {
      if (grid.cells[idx]) {
        const x = col * CELL_SIZE;
        cells.push(
          `<rect x="${x}" y="${y}" width="${CELL_SIZE - 1}" height="${CELL_SIZE - 1}" fill="${palette.bright}" />`,
          `<rect x="${x}" y="${y}" width="2" height="2" fill="${palette.hot}" />`,
        );
      }
      idx++;
    }
  }

  const lines: string[] = [];
  for (let x = 0; x < grid.width; x += CELL_SIZE) {
    lines.push(
      `<line x1="${x}" y1="0" x2="${x}" y2="${grid.height}" stroke="rgba(${r},${g},${b},0.04)" stroke-width="0.5" />`,
    );
  }
  for (let y = 0; y < grid.height; y += CELL_SIZE) {
    lines.push(
      `<line x1="0" y1="${y}" x2="${grid.width}" y2="${y}" stroke="rgba(${r},${g},${b},0.04)" stroke-width="0.5" />`,
    );
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${grid.width} ${grid.height}" width="${grid.width}" height="${grid.height}" shape-rendering="crispEdges">`,
    `<rect width="${grid.width}" height="${grid.height}" fill="${palette.bg}" />`,
    ...cells,
    ...lines,
    "</svg>",
  ].join("");
}

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

export default function LogoSquareTempPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [svgMarkup, setSvgMarkup] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let cancelled = false;
    let rafId = 0;
    let fontReady = false;

    const draw = () => {
      if (cancelled || !fontReady) return;
      const logo = renderSquareLogo(canvas, ctx);
      setSvgMarkup(buildSvgMarkup(logo));
    };

    const scheduleDraw = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        draw();
      });
    };

    const container = canvas.parentElement;
    const ro = new ResizeObserver(scheduleDraw);
    if (container) ro.observe(container);

    void document.fonts.ready.then(() => {
      if (cancelled) return;
      fontReady = true;
      draw();
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, []);

  const copySvg = async () => {
    if (!svgMarkup) return;
    try {
      await navigator.clipboard.writeText(svgMarkup);
      setStatus("SVG copied");
    } catch {
      setStatus("Clipboard blocked for text");
    }
  };

  const copyPng = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const blob = await canvasToBlob(canvas);
    if (!blob) {
      setStatus("PNG export failed");
      return;
    }

    if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
      setStatus("Clipboard image is not available in this browser");
      return;
    }

    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          [blob.type]: blob,
        }),
      ]);
      setStatus("PNG copied");
    } catch {
      setStatus("Clipboard blocked for image");
    }
  };

  const downloadPng = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const blob = await canvasToBlob(canvas);
    if (!blob) return;

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "hive-logo-square.png";
    a.click();
    URL.revokeObjectURL(url);
    setStatus("PNG downloaded");
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 py-10">
      <div className="w-full max-w-[560px] space-y-2 text-center">
        <h1 className="font-mono text-base tracking-wide text-foreground">
          HIVE square logo (temp)
        </h1>
        <p className="font-mono text-xs text-muted-foreground">
          Static pixel render with a centered H.
        </p>
      </div>

      <div className="w-full max-w-[560px]">
        <div className="aspect-square w-full overflow-hidden rounded border border-border/60 bg-background">
          <canvas
            ref={canvasRef}
            className="block h-full w-full"
            style={{ imageRendering: "pixelated", background: BG }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={copySvg}
          className="rounded border border-border bg-background px-3 py-1.5 font-mono text-xs text-foreground transition-colors hover:bg-muted/30"
        >
          Copy SVG
        </button>
        <button
          type="button"
          onClick={copyPng}
          className="rounded border border-border bg-background px-3 py-1.5 font-mono text-xs text-foreground transition-colors hover:bg-muted/30"
        >
          Copy PNG
        </button>
        <button
          type="button"
          onClick={downloadPng}
          className="rounded border border-border bg-background px-3 py-1.5 font-mono text-xs text-foreground transition-colors hover:bg-muted/30"
        >
          Download PNG
        </button>
      </div>

      <p className="h-4 font-mono text-xs text-muted-foreground">{status}</p>
    </div>
  );
}
