import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import "./index.css";
import { copyToClipboard } from "@/lib/clipboard";
import App from "./App";
import { ErrorBoundary } from "@/components/ErrorBoundary";

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
