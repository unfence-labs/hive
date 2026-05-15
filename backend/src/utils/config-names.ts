export function normalizeConfigName(name: string, prefixes: string[] = []): string {
  let normalized = name.trim();
  for (const prefix of prefixes) {
    normalized = normalized.replace(new RegExp(`^\\${prefix}`), "");
  }
  return normalized.trim();
}

export function safeConfigFileStem(name: string): string {
  const stem = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return stem === "." || stem === ".." ? "" : stem;
}
