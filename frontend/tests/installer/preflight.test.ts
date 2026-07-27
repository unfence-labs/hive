import { describe, expect, it } from "vitest";
import type { PreflightCheck, PreflightReport } from "@/lib/provision-client";
import { firewallRuleWillBeWritten, serverInterfaces } from "@/pages/installer/preflight";

/**
 * Reading the two findings the firewall question is derived from.
 *
 * Both come off a shell script's NDJSON, so neither may be trusted to have the
 * shape it usually has: a client that throws on an unexpected `data` object
 * strands the operator on a screen that cannot render its own report.
 */
function reportWith(...checks: PreflightCheck[]): PreflightReport {
  return {
    ok: true,
    blockers: [],
    checks,
    privilege: { mode: "root" },
  };
}

function firewall(data: Record<string, unknown>): PreflightCheck {
  return { check: "firewall", status: "ok", detail: "", data };
}

function interfaces(data: Record<string, unknown>): PreflightCheck {
  return { check: "interfaces", status: "ok", detail: "", data };
}

describe("reading the preflight report", () => {
  it("writes a rule only for an active ufw, and so asks only then", () => {
    const willWrite = (data: Record<string, unknown>) =>
      firewallRuleWillBeWritten(reportWith(firewall(data)));

    expect(willWrite({ backend: "ufw", active: true })).toBe(true);

    // No rule is written in any of these, so there is nothing to choose.
    expect(willWrite({ backend: "ufw", active: false })).toBe(false);
    expect(willWrite({ backend: "none", active: false })).toBe(false);
    expect(willWrite({ backend: "nftables", active: true })).toBe(false);
    // Unreadable without root: unknown is not the same as active.
    expect(willWrite({ backend: "ufw", active: null })).toBe(false);
    expect(firewallRuleWillBeWritten(reportWith())).toBe(false);
  });

  it("reads the enumerated interfaces, and offers none rather than a broken one", () => {
    expect(
      serverInterfaces(
        reportWith(
          interfaces({
            interfaces: [
              { name: "eth0", addresses: ["203.0.113.10"] },
              { name: "wg0", addresses: [] },
            ],
          }),
        ),
      ),
    ).toEqual([
      { name: "eth0", addresses: ["203.0.113.10"] },
      { name: "wg0", addresses: [] },
    ]);

    // A nameless or malformed entry is dropped; the rest of the list stands.
    expect(
      serverInterfaces(
        reportWith(
          interfaces({ interfaces: [null, { name: "" }, "eth0", { name: "eth1", addresses: 7 }] }),
        ),
      ),
    ).toEqual([{ name: "eth1", addresses: [] }]);

    expect(serverInterfaces(reportWith(interfaces({ interfaces: "eth0" })))).toEqual([]);
    expect(serverInterfaces(reportWith())).toEqual([]);
  });
});
