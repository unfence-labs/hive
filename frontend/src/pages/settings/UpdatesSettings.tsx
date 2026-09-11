import { useQuery } from "@tanstack/react-query";
import { SettingsHeader } from "@/components/AppLayout";
import { CenterCard } from "@/components/CenterCard";
import { UpdatePanel } from "@/components/UpdatePanel";
import { api } from "@/hooks/useApi";
import {
  shouldCheckForUpdates,
  useServerCompatibility,
} from "@/hooks/useDesktopUpdate";
import { useAppVersion } from "@/hooks/useAppVersion";
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
  const server = coordinated ? compatibility.server : (backendQuery.data ?? null);
  const serverState = coordinated
    ? compatibility.phase
    : backendQuery.isError
      ? "unavailable"
      : backendQuery.isPending
        ? "checking"
        : "ready";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <SettingsHeader>
        <h1 className="text-sm font-medium">Updates</h1>
      </SettingsHeader>
      <CenterCard scroll>
        <UpdatePanel
          appVersion={appVersion}
          server={server}
          serverState={serverState}
        />
      </CenterCard>
    </div>
  );
}
