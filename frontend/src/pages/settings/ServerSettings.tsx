import { SettingsHeader } from "@/components/AppLayout";
import { CenterCard } from "@/components/CenterCard";
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
        <div className="max-w-2xl space-y-6 px-4 py-5">
          <section className="rounded-lg border border-border/50 bg-card/50 p-5">
            <h2 className="text-sm font-medium text-foreground">Install Hive on a server</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Opens the installer over the app. Nothing changes here unless you finish it.
            </p>
            <Button size="sm" variant="outline" className="mt-3" onClick={onOpenInstaller}>
              Open the installer
            </Button>
          </section>
        </div>
      </CenterCard>
    </div>
  );
}
