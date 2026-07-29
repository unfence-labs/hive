import { cn } from "@/lib/utils";

/**
 * One quiet line, not a banner: the red lead-in carries the weight and the
 * explanation stays in the same muted voice as every other form hint.
 */
export function TransportSecurityWarning({ className }: { className?: string }) {
  return (
    <p role="alert" className={cn("text-xs leading-relaxed text-muted-foreground", className)}>
      <span className="font-medium text-destructive">Private network required.</span>{" "}
      <span>
        HTTPS is not supported yet. Connect through an encrypted private network such as Tailscale,
        WireGuard, or another VPN. Never use a public address.
      </span>
    </p>
  );
}
