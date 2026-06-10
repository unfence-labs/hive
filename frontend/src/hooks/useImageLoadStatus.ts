import { useCallback, useRef, useState } from "react";

export type ImageLoadStatus = "loading" | "loaded" | "error";

type ImageLoadState = {
  src: string | undefined;
  status: ImageLoadStatus;
};

export function useImageLoadStatus(src: string | undefined) {
  const currentSrcRef = useRef(src);
  currentSrcRef.current = src;

  const [state, setState] = useState<ImageLoadState>({
    src,
    status: "loading",
  });

  const status = state.src === src ? state.status : "loading";

  const imageRef = useCallback((img: HTMLImageElement | null) => {
    if (!img) return;

    const nextStatus: ImageLoadStatus = img.complete
      ? img.naturalWidth > 0
        ? "loaded"
        : "error"
      : "loading";

    setState({ src, status: nextStatus });
  }, [src]);

  const handleLoad = useCallback(() => {
    setState({ src: currentSrcRef.current, status: "loaded" });
  }, []);

  const handleError = useCallback(() => {
    setState({ src: currentSrcRef.current, status: "error" });
  }, []);

  return { status, imageRef, handleLoad, handleError };
}
