import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import "./index.css";
import App from "./App";

// When running inside Tauri, reserve space for the native traffic lights
if ("__TAURI_INTERNALS__" in window) {
  document.documentElement.style.setProperty("--titlebar-inset", "40px");
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
