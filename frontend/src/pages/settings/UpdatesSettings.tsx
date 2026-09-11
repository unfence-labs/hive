import { useQuery } from "@tanstack/react-query";
import { SettingsHeader } from "@/components/AppLayout";
import { CenterCard } from "@/components/CenterCard";
import {
  SettingsPanel,
  SettingsSection,
} from "@/components/settings/SettingsSection";
import { UpdateControls } from "@/components/UpdateControls";
import { api } from "@/hooks/useApi";
import {
  shouldCheckForUpdates,
  useServerCompatibility,
} from "@/hooks/useDesktopUpdate";
import { useAppVersion } from "@/hooks/useAppVersion";
import { isDesktopShell } from "@/lib/is-desktop";
import type { ServerVersionResponse } from "@/lib/server-update";

export default function UpdatesSettings() {
  const localAppVersion = useAppVersion();
  const compatibility = useServerCompatibility();
  const coordinated = shouldCheckForUpdates();
  const appVersion = coordinated ? compatibility.appVersion : localAppVersion;
  const backendQuery = useQuery({
    enabled: !coordinated,
    queryKey: ["server", "version"],
    queryFn: () => api.get<ServerVersionResponse>("/api/server/version"),
  });
  const server = coordinated ? compatibility.server : backendQuery.data;
  const unavailable = coordinated
    ? compatibility.phase === "unavailable"
    : backendQuery.isError;
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <SettingsHeader>
        <h1 className="text-sm font-medium">Updates</h1>
      </SettingsHeader>
      <CenterCard scroll>
        <SettingsPanel>
          {isDesktopShell() && (
            <SettingsSection
              title="Hive"
              description={`App version ${appVersion ?? "—"}`}
            >
              <div className="mt-3 text-xs">
                <UpdateControls />
              </div>
            </SettingsSection>
          )}
          <SettingsSection
            title="Server"
            description={`Version ${unavailable ? "unavailable" : (server?.version ?? "—")}`}
          >
            {server?.updateMethod === "manual" && (
              <p className="mt-3 text-xs text-muted-foreground">
                This server was installed manually. Update it manually to the
                same version as the app.
              </p>
            )}
          </SettingsSection>
        </SettingsPanel>
      </CenterCard>
    </div>
  );
}
