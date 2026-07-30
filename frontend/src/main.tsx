import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import "./index.css";
import { copyToClipboard } from "@/lib/clipboard";
import { wsTransport } from "@/lib/ws-transport";
import { initAccentColor } from "@/hooks/useAccentColor";
import App from "./App";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// The stored theme mode is restored by the inline script in index.html; the
// accent color is restored here.
initAccentColor();

// A hub WebSocket can stay readyState OPEN after the OS sleeps/wakes or the
// network changes, never firing onclose — leaving the UI stuck on stale data.
// When the user returns (tab visible / window focus / network back), probe the
// socket; probeLiveness() reconnects only if the probe goes unanswered, so a
// healthy idle conversation is never needlessly reconnected. Works in both the
// browser and the Tauri webview (which receives standard focus events).
const probeHubLiveness = () => wsTransport.probeLiveness();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") probeHubLiveness();
});
window.addEventListener("focus", probeHubLiveness);
window.addEventListener("online", probeHubLiveness);

// Fallback for streamdown's code block copy button in non-secure contexts
// where navigator.clipboard is unavailable (HTTP, remote IP).
document.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest?.('[data-streamdown="code-block-copy-button"]');
  if (!btn) return;
  const code = btn.closest('[data-streamdown="code-block"]')
    ?.querySelector('[data-streamdown="code-block-body"] code');
  if (code?.textContent) copyToClipboard(code.textContent);
});

// When running inside Tauri, reserve space for the native traffic lights
// and react to fullscreen changes (traffic lights hidden in fullscreen).
if ("__TAURI_INTERNALS__" in window) {
  const root = document.documentElement;

  function setTitlebarVars(fullscreen: boolean) {
    if (fullscreen) {
      root.style.setProperty("--titlebar-inset", "0px");
      root.style.setProperty("--traffic-light-clearance", "0px");
    } else {
      root.style.setProperty("--titlebar-inset", "40px");
      root.style.setProperty("--traffic-light-clearance", "80px");
    }
  }

  setTitlebarVars(false);

  import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
    const win = getCurrentWindow();
    let lastFs = false;

    win.onResized(async () => {
      const fs = await win.isFullscreen();
      if (fs !== lastFs) {
        lastFs = fs;
        setTitlebarVars(fs);
      }
    });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
