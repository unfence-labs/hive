import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  // Tailwind's CSS optimizer currently warns on the valid ::highlight()
  // selectors used by conversation search. Vite still minifies the CSS.
  plugins: [react(), tailwindcss({ optimize: false })],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
    proxy: {
      "/api": "http://localhost:3000",
      "/ws": {
        target: "http://localhost:3000",
        ws: true,
      },
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    // Mermaid is lazy-loaded but emits a ~1.62 MB uncompressed chunk. This
    // limit is global, so re-measure every chunk before raising it.
    chunkSizeWarningLimit: 1650,
    target:
      process.env.TAURI_ENV_PLATFORM === "windows"
        ? "chrome105"
        : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    rollupOptions: {
      output: {
        manualChunks: {
          react: [
            "react",
            "react-dom",
            "react-dom/client",
            "react-router",
            "react-router-dom",
            "scheduler",
          ],
        },
      },
    },
  },
});
