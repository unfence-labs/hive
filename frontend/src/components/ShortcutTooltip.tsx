import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/** Hover tooltip pairing an action label with its keyboard shortcut. */
export function ShortcutTooltip({
  label,
  shortcut,
  children,
}: {
  label: string;
  shortcut: string;
  children: React.ReactNode;
}) {
  return (
    // Own provider so the component drops in anywhere (Radix requires one).
    // Discreet by design: only shows on a deliberate hover, in a compact pill.
    <TooltipProvider>
      <Tooltip delayDuration={500}>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side="top" className="flex items-center gap-1.5 px-2 py-1">
          {label}
          <span className="text-background/60">{shortcut}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
