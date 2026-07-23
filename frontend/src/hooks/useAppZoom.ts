import { useCallback, useEffect, useState } from "react";

const ZOOM_STORAGE_KEY = "hive-app-zoom";
const DEFAULT_ZOOM = 1;
const MIN_ZOOM = 0.8;
const MAX_ZOOM = 1.4;
const ZOOM_STEP = 0.1;

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 10) / 10));
}

function storedZoom(): number {
  const value = Number(localStorage.getItem(ZOOM_STORAGE_KEY));
  return Number.isFinite(value) && value > 0 ? clampZoom(value) : DEFAULT_ZOOM;
}

export function useAppZoom() {
  const [zoom, setZoom] = useState(storedZoom);

  useEffect(() => {
    document.documentElement.style.zoom = String(zoom);
    localStorage.setItem(ZOOM_STORAGE_KEY, String(zoom));
  }, [zoom]);

  const zoomIn = useCallback(() => setZoom((value) => clampZoom(value + ZOOM_STEP)), []);
  const zoomOut = useCallback(() => setZoom((value) => clampZoom(value - ZOOM_STEP)), []);
  const resetZoom = useCallback(() => setZoom(DEFAULT_ZOOM), []);

  return { zoomIn, zoomOut, resetZoom };
}
