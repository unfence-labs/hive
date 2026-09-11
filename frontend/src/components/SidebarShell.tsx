import { ServerMetrics } from "@/components/ServerMetrics";
import { ProviderUsage } from "@/components/ProviderUsage";

interface SidebarShellProps {
  children: React.ReactNode;
  footerActions: React.ReactNode;
  showServerStatus?: boolean;
}

export function SidebarShell({
  children,
  footerActions,
  showServerStatus = true,
}: SidebarShellProps) {
  return (
    <div className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground">
      <div
        className="shrink-0"
        style={{ height: "max(var(--titlebar-inset, 0px), 3rem)" }}
        data-tauri-drag-region
      />

      {children}

      {/* Dropped entirely when empty: an unused footer is a stray rule. */}
      {(footerActions || showServerStatus) && (
        <div className="shrink-0 border-t border-border">
          {footerActions}
          {showServerStatus && (
            <div className="grid gap-2 border-t border-border px-3 py-2">
              <ProviderUsage />
              <ServerMetrics />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
