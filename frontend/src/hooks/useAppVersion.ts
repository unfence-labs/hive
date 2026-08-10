import { useEffect, useState } from "react";
import { isDesktopShell } from "@/lib/is-desktop";

/**
 * The desktop build's own version; the web app has none of its own. Asked from
 * Rust because the JS-side `getVersion()` reports the numeric macOS bundle
 * version, which drops prerelease suffixes like `-beta.5`.
 */
export function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    if (!isDesktopShell()) return;
    let active = true;
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<string>("app_version"))
      .then((v) => {
        if (active) setVersion(v);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return version;
}
