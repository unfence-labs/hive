import { SettingsHeader } from "@/components/AppLayout";
import { CenterCard } from "@/components/CenterCard";
import { SettingsPanel, SettingsSection } from "@/components/settings/SettingsSection";
import { Button } from "@/components/ui/button";

interface ServerSettingsProps {
  /** Opens the installer over the app. Abandoning it changes nothing. */
  onOpenInstaller: () => void;
}

/**
 * The server itself, as opposed to Connection, which is how this client
 * reaches one. Desktop-only: installing runs over the shell's SSH sidecar, so
 * the web build gets neither this page's route nor its sidebar entry.
 */
export default function ServerSettings({ onOpenInstaller }: ServerSettingsProps) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <SettingsHeader>
        <h1 className="text-sm font-medium">Server</h1>
      </SettingsHeader>

      <CenterCard scroll>
        <SettingsPanel>
          <SettingsSection
            title="Install Hive on a server"
            description="Opens the installer over the app. Nothing changes here unless you finish it."
          >
            <Button size="sm" variant="outline" className="mt-4" onClick={onOpenInstaller}>
              Open the installer
            </Button>
          </SettingsSection>
        </SettingsPanel>
      </CenterCard>
    </div>
  );
}
