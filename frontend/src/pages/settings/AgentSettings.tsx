import { SettingsHeader } from "@/components/AppLayout";
import { CenterCard } from "@/components/CenterCard";
import { SettingsPanel } from "@/components/settings/SettingsSection";
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
        <SettingsPanel className="space-y-4 py-6">
          <ToolsPanel />
          {/*
            The note lives here, not in ToolsPanel: the installer reuses that
            panel and already states the requirement in its own copy. And it is
            a statement of what works, never a gate — nothing in the panel is
            disabled for want of the second harness.
          */}
          <p className="text-xs text-muted-foreground">At least one harness needed to run Hive</p>
        </SettingsPanel>
      </CenterCard>
    </div>
  );
}
