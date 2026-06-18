import { useCallback, useEffect, useMemo, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useThemeType } from "@/hooks/useThemeType";
import "@xterm/xterm/css/xterm.css";

function readThemeColor(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function buildXtermTheme(theme: "dark" | "light", backgroundVar = "--sidebar") {
  const foreground = readThemeColor("--foreground", theme === "dark" ? "#e4e4e7" : "#18181b");
  return {
    background: readThemeColor(backgroundVar, theme === "dark" ? "#0c0c14" : "#f8f8fb"),
    foreground,
    cursor: foreground,
    selectionBackground: readThemeColor("--muted", theme === "dark" ? "#262636" : "#f0f1f4"),
  };
}

export interface XtermSurfaceProps {
  /**
   * Wire a freshly-created terminal to its data source. Return a disconnect
   * function (called on teardown/unmount/key change), or nothing if there is
   * nothing to tear down. Treat as stable — it is captured per (re)connect.
   */
  connect: (term: XTerm) => (() => void) | void;
  /**
   * Changing this string tears down the current terminal and reconnects a fresh
   * one. Use it to force a reconnect (e.g. tab switch, restart) without
   * remounting the component.
   */
  connectKey?: string;
  className?: string;
  /**
   * CSS custom property driving the terminal background. Defaults to the panel
   * background (`--sidebar`), which suits the scripts panel; the in-chat
   * terminal passes `--card` so it blends with the conversation card it lives in.
   */
  backgroundVar?: string;
}

/**
 * Reusable xterm surface owning the terminal instance lifecycle: creation, fit,
 * theme (with live updates), a ResizeObserver-driven refit, and teardown. It
 * invokes {@link XtermSurfaceProps.connect} once the terminal is mounted and
 * runs the returned disconnect function on cleanup.
 *
 * Shared by ScriptPanel (setup/run/terminal output) and TerminalPane
 * (full-pane interactive shell).
 */
export function XtermSurface({ connect, connectKey, className, backgroundVar }: XtermSurfaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const theme = useThemeType();
  const xtermTheme = useMemo(() => buildXtermTheme(theme, backgroundVar), [theme, backgroundVar]);
  const themeRef = useRef(xtermTheme);
  themeRef.current = xtermTheme;

  const termRef = useRef<XTerm | null>(null);

  // Keep the latest connect callback without forcing a reconnect when only its
  // identity changes; reconnects are driven solely by `connectKey`.
  const connectRef = useRef(connect);
  connectRef.current = connect;

  const refit = useCallback((fitAddon: FitAddon) => {
    try {
      fitAddon.fit();
    } catch {
      // fit() can throw if the container has no layout yet; ignore.
    }
  }, []);

  // Create + connect the terminal; rebuild on connectKey change.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new XTerm({
      cursorBlink: false,
      fontSize: 12,
      fontFamily: '"Geist Mono", Menlo, Monaco, "Courier New", monospace',
      lineHeight: 1.3,
      theme: themeRef.current,
      scrollback: 5000,
      disableStdin: false,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(el);
    refit(fitAddon);

    termRef.current = term;

    const observer = new ResizeObserver(() => refit(fitAddon));
    observer.observe(el);

    const disconnect = connectRef.current(term);

    return () => {
      observer.disconnect();
      disconnect?.();
      term.dispose();
      termRef.current = null;
    };
  }, [connectKey, refit]);

  // Live theme updates without recreating the terminal.
  useEffect(() => {
    const term = termRef.current;
    if (term?.options) {
      term.options.theme = xtermTheme;
    }
  }, [xtermTheme]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ backgroundColor: xtermTheme.background }}
    />
  );
}
