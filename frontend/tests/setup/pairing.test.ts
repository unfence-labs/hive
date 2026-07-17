import { describe, expect, it } from "vitest";
import { buildPairingUrl, parsePairingUrl } from "@/lib/pairing";
import type { PairingPayload } from "@hive/shared/setup-types";

describe("pairing url", () => {
  const payload: PairingPayload = {
    v: 1,
    host: "100.101.102.103",
    port: 3000,
    token: "hive_abc123",
    name: "Hive",
  };

  it("builds a hive://pair deep link with all fields", () => {
    const url = buildPairingUrl(payload);
    expect(url).toBe(
      "hive://pair?v=1&host=100.101.102.103&port=3000&token=hive_abc123&name=Hive",
    );
  });

  it("omits name when absent", () => {
    const url = buildPairingUrl({ v: 1, host: "h", port: 3000, token: "t" });
    expect(url).toBe("hive://pair?v=1&host=h&port=3000&token=t");
  });

  it("round-trips through parse", () => {
    expect(parsePairingUrl(buildPairingUrl(payload))).toEqual(payload);
  });

  it("rejects malformed or foreign urls", () => {
    expect(parsePairingUrl("https://example.com")).toBeNull();
    expect(parsePairingUrl("hive://pair?v=1&host=h")).toBeNull(); // missing token/port
    expect(parsePairingUrl("hive://pair?v=x&host=h&port=3000&token=t")).toBeNull();
  });
});
