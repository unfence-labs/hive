const STORAGE_KEY = "hive-ssh-connection";

/**
 * SSH connection details kept after the install wizard so the app can push
 * backend updates over SSH later. Only the key *path* is stored, never the key.
 */
export interface SshConnection {
  host: string;
  keyPath: string;
  user?: string;
  /** True when the server was installed in tailnet mode (vs local/OrbStack). */
  tailnet: boolean;
}

export function saveSshConnection(conn: SshConnection): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conn));
  } catch {
    // best-effort
  }
}

export function loadSshConnection(): SshConnection | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SshConnection>;
    if (!parsed.host || !parsed.keyPath) return null;
    return {
      host: parsed.host,
      keyPath: parsed.keyPath,
      user: parsed.user,
      tailnet: parsed.tailnet ?? false,
    };
  } catch {
    return null;
  }
}

export function clearSshConnection(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
