import { useState, useEffect } from "react";
import { detectTerminals, type TerminalApp } from "@/lib/terminal";

/**
 * Detect available terminal applications (Tauri desktop only).
 * Returns an empty array in browser mode.
 * Detection runs once on mount.
 */
export function useTerminalApps(): TerminalApp[] {
  const [terminals, setTerminals] = useState<TerminalApp[]>([]);

  useEffect(() => {
    detectTerminals().then(setTerminals);
  }, []);

  return terminals;
}
