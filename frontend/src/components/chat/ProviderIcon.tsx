import { cn } from "@/lib/utils";

/** Providers we render a brand mark for today. Extend the map below to add more. */
export type KnownProvider = "codex" | "claude" | "kimi";

export function isKnownProvider(provider?: string): provider is KnownProvider {
  return provider === "codex" || provider === "claude" || provider === "kimi";
}

/** Brand color per provider, applied to the mark so it reads in its own hue. */
const BRAND_COLOR: Record<string, string> = {
  codex: "#10A37F", // OpenAI green
  claude: "#D97757", // Anthropic clay
  kimi: "#00B899", // Moonshot teal
};

/**
 * Provider brand mark: the OpenAI swirl for Codex, the Anthropic burst for
 * Claude. Monochrome (inherits `currentColor`) by default to match the rest of
 * the UI; pass `colored` to render the mark in its brand color (used in the
 * conversation tab strip for at-a-glance recognition). Unknown providers fall
 * back to the Claude mark — callers that must not show a wrong brand (e.g.
 * before a session locks its provider) should gate on {@link isKnownProvider}.
 */
export function ProviderIcon({
  provider,
  className,
  colored = false,
}: {
  provider: string;
  className?: string;
  colored?: boolean;
}) {
  const style = colored && BRAND_COLOR[provider] ? { color: BRAND_COLOR[provider] } : undefined;
  if (provider === "codex") {
    return (
      <svg className={cn("size-3.5", className)} style={style} viewBox="0 0 24 24" fill="currentColor">
        <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
      </svg>
    );
  }
  if (provider === "kimi") {
    // Crescent-moon mark for Kimi (Moonshot AI).
    return (
      <svg className={cn("size-3.5", className)} style={style} viewBox="0 0 24 24" fill="currentColor">
        <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
      </svg>
    );
  }
  // Claude mark.
  return (
    <svg className={cn("size-3.5", className)} style={style} viewBox="0 0 600 600" fill="currentColor">
      <path d="M119 398.8 236.3 333l2-5.8-2-3.1h-5.7l-19.6-1.2-67-1.9-58.2-2.4-56.3-3-14.2-3L2 295l1.4-8.8 11.9-8 17 1.5 37.8 2.6 56.6 3.9 41 2.4 61 6.3h9.6l1.4-3.9-3.3-2.4-2.6-2.4-58.6-39.7-63.4-42-33.2-24.1-18-12.3-9-11.4-4-25 16.3-18 22 1.4 5.5 1.5 22.2 17.1 47.4 36.7 62 45.6 9 7.5 3.6-2.6.4-1.8-4-6.8-33.7-60.8-36-62L146.5 64l-4.2-15.4a75 75 0 0 1-2.6-18l18.6-25.3L168.4 2l24.8 3.3 10.4 9L219 49.7l25 55.4 38.6 75.3 11.3 22.4 6 20.7 2.3 6.3h4V226l3-42.5 6-52.1 5.7-67 2-19 9.3-22.6 18.6-12.2 14.5 7 11.9 17-1.7 11-7 46.1-14 72.2-9 48.3h5.3l6-6 24.4-32.5 41.1-51.4 18.1-20.3 21.2-22.5 13.6-10.8h25.6L519.7 97l-8.5 29-26.4 33.5-21.9 28.4-31.4 42.3-19.6 33.8 1.8 2.7 4.7-.4 71-15.1 38.3-7 45.7-7.8 20.7 9.6 2.3 9.9-8.2 20-48.9 12.1-57.4 11.5-85.4 20.2-1 .8 1.1 1.5 38.5 3.6 16.5.9h40.3l75 5.6 19.7 13 11.7 15.8-2 12.1-30.1 15.4-40.8-9.7-95.1-22.6-32.6-8.1h-4.5v2.7l27.1 26.5 49.9 45 62.3 58 3.2 14.3-8 11.4-8.5-1.2-54.8-41.3-21.1-18.5-47.9-40.4h-3.2v4.3l11 16.1 58.3 87.6 3 26.9-4.2 8.7-15 5.3-16.7-3-34-48-35.3-53.8L331 400l-3.5 2-16.8 180.4-7.8 9.3-18.1 6.9-15.1-11.5-8-18.5 8-36.7 9.6-48 7.9-38 7-47.2 4.3-15.7-.3-1-3.4.4-35.7 48.9-54.2 73.2-42.9 46-10.2 4-17.8-9.2 1.6-16.5 10-14.6 59.3-75.5 35.8-46.8 23.1-27-.1-4h-1.4L104.6 463.4l-28 3.6-12.1-11.3 1.5-18.6 5.7-6 47.4-32.6-.2.1z" />
    </svg>
  );
}
