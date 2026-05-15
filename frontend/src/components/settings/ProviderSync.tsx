import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Link2, Loader2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ProviderSyncStatus =
  | "missing"
  | "both"
  | "linked"
  | "synced"
  | "claude_only"
  | "codex_only"
  | "diverged"
  | "invalid";

export interface ProviderBadgeState {
  present: boolean;
  path: string;
  isSymlink?: boolean;
}

export function SettingsActionButton({
  variant = "secondary",
  pending = false,
  disabled = false,
  icon,
  children,
  onClick,
}: {
  variant?: "primary" | "secondary" | "danger";
  pending?: boolean;
  disabled?: boolean;
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
}) {
  const disabledState = disabled || pending;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabledState}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        variant === "primary"
          ? "bg-primary text-primary-foreground hover:bg-primary/90"
          : "text-muted-foreground",
        variant === "secondary" && "border border-border/50",
        variant === "secondary" && "hover:text-foreground",
        variant === "danger" && "hover:text-red-400",
        disabledState && "pointer-events-none opacity-60",
      )}
    >
      {pending ? (
        <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
      ) : (
        <span aria-hidden="true" className="flex">
          {icon}
        </span>
      )}
      {children}
    </button>
  );
}

export function SettingsBanner({
  tone,
  icon,
  children,
}: {
  tone: "info" | "warning" | "danger";
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-xs",
        tone === "info" && "border-sky-500/25 bg-sky-500/10 text-sky-300",
        tone === "warning" && "border-amber-500/25 bg-amber-500/10 text-amber-300",
        tone === "danger" && "border-red-500/25 bg-red-500/10 text-red-300",
      )}
    >
      <span aria-hidden="true" className="shrink-0">
        {icon}
      </span>
      {children}
    </div>
  );
}

export function ProviderBadge({
  label,
  state,
}: {
  label: string;
  state: ProviderBadgeState;
}) {
  return (
    <span
      title={state.path}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
        state.present
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
          : "border-border bg-muted/50 text-muted-foreground",
      )}
    >
      {state.present ? (
        <CheckCircle2 aria-hidden="true" className="h-3 w-3" />
      ) : (
        <XCircle aria-hidden="true" className="h-3 w-3" />
      )}
      {label}
      {state.isSymlink && <Link2 aria-hidden="true" className="h-3 w-3" />}
    </span>
  );
}

export function SyncStatusBadge({ status }: { status: ProviderSyncStatus }) {
  const config = statusConfig(status);
  return (
    <Badge variant="secondary" className={cn("text-[10px]", config.className)}>
      {config.label}
    </Badge>
  );
}

export function CompactSyncStatusIcon({ status }: { status: ProviderSyncStatus }) {
  if (status === "both" || status === "linked" || status === "synced") {
    return <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-emerald-400" />;
  }
  if (status === "invalid") {
    return <XCircle aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-red-400" />;
  }
  return <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-amber-400" />;
}

function statusConfig(status: ProviderSyncStatus): { label: string; className: string } {
  switch (status) {
    case "missing":
      return { label: "Missing", className: "bg-muted text-muted-foreground" };
    case "both":
      return { label: "Both", className: "bg-emerald-500/10 text-emerald-400" };
    case "linked":
      return { label: "Linked", className: "bg-emerald-500/10 text-emerald-400" };
    case "synced":
      return { label: "Synced", className: "bg-sky-500/10 text-sky-400" };
    case "claude_only":
      return { label: "Claude only", className: "bg-amber-500/10 text-amber-400" };
    case "codex_only":
      return { label: "Codex only", className: "bg-amber-500/10 text-amber-400" };
    case "diverged":
      return { label: "Diverged", className: "bg-amber-500/10 text-amber-400" };
    case "invalid":
      return { label: "Invalid", className: "bg-red-500/10 text-red-400" };
  }
}
