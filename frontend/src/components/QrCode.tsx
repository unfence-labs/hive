import { useMemo } from "react";
import { encodeQr } from "@/lib/qr";

interface QrCodeProps {
  value: string;
  /** Rendered pixel size of the square QR (excluding quiet zone). */
  size?: number;
  className?: string;
}

const QUIET = 4; // modules of quiet zone per spec

/** Render a QR code for `value` as a crisp SVG (dependency-free encoder). */
export function QrCode({ value, size = 220, className }: QrCodeProps) {
  const matrix = useMemo(() => {
    try {
      return encodeQr(value);
    } catch {
      return null;
    }
  }, [value]);

  if (!matrix) {
    return (
      <div
        className={className}
        style={{ width: size, height: size }}
        role="img"
        aria-label="QR code unavailable"
      />
    );
  }

  const total = matrix.size + QUIET * 2;
  const rects: string[] = [];
  for (let r = 0; r < matrix.size; r++) {
    for (let c = 0; c < matrix.size; c++) {
      if (matrix.modules[r][c]) {
        rects.push(`M${c + QUIET},${r + QUIET}h1v1h-1z`);
      }
    }
  }

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${total} ${total}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="Pairing QR code"
    >
      <rect width={total} height={total} fill="#ffffff" />
      <path d={rects.join("")} fill="#000000" />
    </svg>
  );
}
