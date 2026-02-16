import { useEffect, useRef } from "react";

export type AgentActivitySize = "large" | "small";

const SIZE_CONFIG: Record<AgentActivitySize, { dot: number; gap: number }> = {
  large: { dot: 4, gap: 1 },
  small: { dot: 3, gap: 1 },
};

interface AgentActivityPreviewProps {
  size?: AgentActivitySize;
  duration?: number;
}

export default function AgentActivityPreview({
  size = "large",
  duration = 1100,
}: AgentActivityPreviewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const rectsRef = useRef<(SVGRectElement | null)[]>([]);
  const matrixRef = useRef<SVGFEColorMatrixElement>(null);
  const { dot, gap } = SIZE_CONFIG[size];

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const computed = getComputedStyle(svg).color;
    const match = computed.match(/(\d+),\s*(\d+),\s*(\d+)/);
    const [r0, g0, b0] = match ? [+match[1], +match[2], +match[3]] : [107, 123, 245];

    // Update glow filter color
    if (matrixRef.current) {
      matrixRef.current.setAttribute(
        "values",
        `0 0 0 0 ${r0 / 255}  0 0 0 0 ${g0 / 255}  0 0 0 0 ${b0 / 255}  0 0 0 0.5 0`,
      );
    }

    const dimR = Math.round(r0 * 0.12);
    const dimG = Math.round(g0 * 0.12);
    const dimB = Math.round(b0 * 0.12);

    const phases = Array.from({ length: 9 }, (_, i) => {
      const col = i % 3, row = Math.floor(i / 3);
      return (Math.atan2(row - 1, col - 1) / (Math.PI * 2) + 1) % 1;
    });

    const start = performance.now();
    let raf: number;

    function tick(now: number) {
      const t = ((now - start) % duration) / duration;
      for (let i = 0; i < 9; i++) {
        const el = rectsRef.current[i];
        if (!el) continue;
        const p = ((t + phases[i]) % 1 + 1) % 1;
        const raw = (Math.cos((p - 0.5) * Math.PI * 2) + 1) / 2;
        const val = Math.max(0, (raw - 0.2) / 0.8);
        if (val < 0.01) {
          el.setAttribute("opacity", "0");
          el.removeAttribute("filter");
        } else {
          const r = Math.round(dimR + (r0 - dimR) * val);
          const g = Math.round(dimG + (g0 - dimG) * val);
          const b = Math.round(dimB + (b0 - dimB) * val);
          el.setAttribute("opacity", "1");
          el.setAttribute("fill", `rgb(${r},${g},${b})`);
          el.setAttribute("filter", val > 0.45 ? "url(#orbit-glow)" : "");
          el.setAttribute(
            "transform",
            `translate(${(i % 3) * (dot + gap)},${Math.floor(i / 3) * (dot + gap)}) scale(${0.88 + val * 0.12})`,
          );
        }
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dot, gap, duration]);

  const total = dot * 3 + gap * 2;
  const pad = 3;

  return (
    <svg
      ref={svgRef}
      className="text-primary"
      width={total + pad * 2}
      height={total + pad * 2}
      viewBox={`${-pad} ${-pad} ${total + pad * 2} ${total + pad * 2}`}
      role="img"
      aria-label="Agent thinking"
    >
      <defs>
        <filter id="orbit-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
          <feColorMatrix
            ref={matrixRef}
            in="blur"
            type="matrix"
            values="0 0 0 0 0.42  0 0 0 0 0.48  0 0 0 0 0.96  0 0 0 0.5 0"
            result="glow"
          />
          <feMerge>
            <feMergeNode in="glow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {Array.from({ length: 9 }, (_, i) => (
        <rect
          key={i}
          ref={(el) => { rectsRef.current[i] = el; }}
          width={dot}
          height={dot}
          rx={1}
          ry={1}
          opacity={0}
        />
      ))}
    </svg>
  );
}
