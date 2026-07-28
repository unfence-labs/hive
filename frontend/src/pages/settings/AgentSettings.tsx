import { SettingsHeader } from "@/components/AppLayout";
import { CenterCard } from "@/components/CenterCard";
import { ToolsPanel } from "@/components/setup/ToolsPanel";

/**
 * Settings host for {@link ToolsPanel}. Everything page-shaped — the header,
 * the card, the width — lives here, so the panel itself stays reusable by the
 * installer's final screen.
 */
export default function AgentSettings() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <SettingsHeader>
        <h1 className="text-sm font-medium">Harness</h1>
      </SettingsHeader>

      <CenterCard scroll>
        <div className="max-w-2xl space-y-4 px-4 py-5">
          <ToolsPanel />
          <p className="text-xs text-muted-foreground">
            Command-line tools Hive runs on this server. Installs go into the service
            account's own directory, never system-wide.
          </p>
        </div>
      </CenterCard>
    </div>
  );
}
