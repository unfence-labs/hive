import { ServerMetrics } from "@/components/ServerMetrics";

interface SidebarShellProps {
  children: React.ReactNode;
  footerActions: React.ReactNode;
  headerActions?: React.ReactNode;
}

export function SidebarShell({ children, footerActions, headerActions }: SidebarShellProps) {
  return (
    <div className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground">
      <div
        className="flex shrink-0 items-end justify-end px-2 pb-1"
        style={{ minHeight: "max(var(--titlebar-inset, 0px), 3rem)" }}
        data-tauri-drag-region
      >
        {headerActions}
      </div>

      {children}

      <div className="shrink-0 border-t border-border/50">
        {footerActions}
        <div className="mx-2 border-t border-border/50" />
        <div className="px-3 pb-2 pt-1.5">
          <ServerMetrics />
        </div>
      </div>
    </div>
  );
}
