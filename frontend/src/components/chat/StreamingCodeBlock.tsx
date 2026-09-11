import { cloneElement, isValidElement, useContext, useMemo, type ComponentProps, type ReactElement } from "react";
import { StreamdownContext, useIsCodeFenceIncomplete } from "streamdown";

/** Keep Streamdown's code renderer, but scope its controls to the current fence. */
export function StreamingCodeBlock({ children }: ComponentProps<"pre">) {
  const context = useContext(StreamdownContext);
  const incomplete = useIsCodeFenceIncomplete();
  const value = useMemo(
    () => ({ ...context, isAnimating: context.isAnimating && incomplete }),
    [context, incomplete],
  );

  return (
    <StreamdownContext.Provider value={value}>
      {isValidElement(children)
        // Streamdown's default pre renderer marks its code child as a block.
        ? cloneElement(children as ReactElement<{ "data-block"?: string }>, { "data-block": "true" })
        : children}
    </StreamdownContext.Provider>
  );
}
