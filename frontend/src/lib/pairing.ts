import type { PairingPayload } from "@hive/shared/setup-types";

/**
 * Build the `hive://pair?…` deep link encoded in the iOS pairing QR (§3.7).
 * Pure function, unit-tested; the Swift side has a mirror parser.
 */
export function buildPairingUrl(payload: PairingPayload): string {
  const params = new URLSearchParams();
  params.set("v", String(payload.v));
  params.set("host", payload.host);
  params.set("port", String(payload.port));
  params.set("token", payload.token);
  if (payload.name) params.set("name", payload.name);
  return `hive://pair?${params.toString()}`;
}

/** Parse a `hive://pair?…` deep link back into a payload (mirror of the Swift parser). */
export function parsePairingUrl(url: string): PairingPayload | null {
  const match = /^hive:\/\/pair\?(.*)$/.exec(url.trim());
  if (!match) return null;
  const params = new URLSearchParams(match[1]);
  const host = params.get("host");
  const token = params.get("token");
  const v = Number(params.get("v"));
  const port = Number(params.get("port"));
  if (!host || !token || !Number.isFinite(v) || !Number.isFinite(port)) return null;
  const payload: PairingPayload = { v, host, port, token };
  const name = params.get("name");
  if (name) payload.name = name;
  return payload;
}
