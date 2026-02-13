import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

interface TerminalContextType {
  /** Workspace IDs with a live terminal */
  activeTerminals: Set<string>;
  /** Which terminal overlay is currently shown (null = none) */
  visibleTerminalWsId: string | null;
  /** Activate terminal for workspace and make it visible */
  openTerminal: (wsId: string) => void;
  /** Show or hide the terminal overlay (null = hide all) */
  setVisibleTerminal: (wsId: string | null) => void;
}

const TerminalContext = createContext<TerminalContextType | null>(null);

export function TerminalProvider({ children }: { children: ReactNode }) {
  const [activeTerminals, setActiveTerminals] = useState<Set<string>>(new Set());
  const [visibleTerminalWsId, setVisibleTerminalWsId] = useState<string | null>(null);

  const openTerminal = useCallback((wsId: string) => {
    setActiveTerminals((prev) => {
      if (prev.has(wsId)) return prev;
      const next = new Set(prev);
      next.add(wsId);
      return next;
    });
    setVisibleTerminalWsId(wsId);
  }, []);

  const setVisibleTerminal = useCallback((wsId: string | null) => {
    setVisibleTerminalWsId(wsId);
  }, []);

  return (
    <TerminalContext.Provider
      value={{ activeTerminals, visibleTerminalWsId, openTerminal, setVisibleTerminal }}
    >
      {children}
    </TerminalContext.Provider>
  );
}

export function useTerminalContext(): TerminalContextType {
  const ctx = useContext(TerminalContext);
  if (!ctx) throw new Error("useTerminalContext must be used within TerminalProvider");
  return ctx;
}
