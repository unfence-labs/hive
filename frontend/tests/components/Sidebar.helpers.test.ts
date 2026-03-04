import { describe, expect, it } from "vitest";
import {
  parseProjectOwnerRepo,
  automationSortKey,
  describeSchedule,
} from "@/components/Sidebar";
import type { Automation } from "@/types";

// ── parseProjectOwnerRepo ───────────────────────────────────────────

describe("parseProjectOwnerRepo", () => {
  it("parses HTTPS GitHub URL", () => {
    expect(parseProjectOwnerRepo("https://github.com/acme/alpha.git")).toEqual({
      owner: "acme",
      repo: "alpha",
    });
  });

  it("parses HTTPS URL without .git suffix", () => {
    expect(parseProjectOwnerRepo("https://github.com/acme/alpha")).toEqual({
      owner: "acme",
      repo: "alpha",
    });
  });

  it("parses SCP-style SSH URL (git@)", () => {
    expect(parseProjectOwnerRepo("git@github.com:acme/alpha.git")).toEqual({
      owner: "acme",
      repo: "alpha",
    });
  });

  it("parses SCP-style SSH URL without .git suffix", () => {
    expect(parseProjectOwnerRepo("git@github.com:acme/alpha")).toEqual({
      owner: "acme",
      repo: "alpha",
    });
  });

  it("parses SSH protocol URL", () => {
    expect(parseProjectOwnerRepo("ssh://git@github.com/acme/alpha.git")).toEqual({
      owner: "acme",
      repo: "alpha",
    });
  });

  it("parses GitLab URL with nested path (uses first two segments)", () => {
    expect(parseProjectOwnerRepo("https://gitlab.com/org/subgroup/repo.git")).toEqual({
      owner: "org",
      repo: "subgroup",
    });
  });

  it("returns null for unrecognized string", () => {
    expect(parseProjectOwnerRepo("just-a-name")).toBeNull();
  });

  it("returns null for URL with single path segment", () => {
    expect(parseProjectOwnerRepo("https://github.com/acme")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseProjectOwnerRepo("")).toBeNull();
  });
});

// ── automationSortKey ──────────────────────────────────────────────

describe("automationSortKey", () => {
  function makeAuto(overrides: Partial<Automation>): Automation {
    return {
      id: "a1",
      name: "Test",
      enabled: true,
      trigger: { type: "cron", expression: "0 * * * *" },
      action: { type: "agent", modelId: "claude:opus-4-6", userPromptInline: "test" },
      notification: { onComplete: false, onFailure: false },
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      ...overrides,
    };
  }

  it("returns 0 for running automations", () => {
    expect(automationSortKey(makeAuto({ lastRunStatus: "running" }))).toBe(0);
  });

  it("returns 1 for enabled automations", () => {
    expect(automationSortKey(makeAuto({ enabled: true }))).toBe(1);
  });

  it("returns 2 for disabled automations", () => {
    expect(automationSortKey(makeAuto({ enabled: false }))).toBe(2);
  });

  it("running takes priority over enabled", () => {
    expect(
      automationSortKey(makeAuto({ enabled: true, lastRunStatus: "running" })),
    ).toBe(0);
  });

  it("sorts running < enabled < disabled", () => {
    const running = makeAuto({ lastRunStatus: "running", enabled: true });
    const enabled = makeAuto({ enabled: true });
    const disabled = makeAuto({ enabled: false });

    const sorted = [disabled, running, enabled].sort(
      (a, b) => automationSortKey(a) - automationSortKey(b),
    );

    expect(sorted).toEqual([running, enabled, disabled]);
  });
});

// ── describeSchedule ───────────────────────────────────────────────

describe("describeSchedule", () => {
  it("returns 'Hourly' for '0 * * * *'", () => {
    expect(describeSchedule("0 * * * *")).toBe("Hourly");
  });

  it("returns 'Every 6h' for '0 */6 * * *'", () => {
    expect(describeSchedule("0 */6 * * *")).toBe("Every 6h");
  });

  it("returns 'Daily 2am' for '0 2 * * *'", () => {
    expect(describeSchedule("0 2 * * *")).toBe("Daily 2am");
  });

  it("returns 'Daily 8am' for '0 8 * * *'", () => {
    expect(describeSchedule("0 8 * * *")).toBe("Daily 8am");
  });

  it("returns 'Daily midnight' for '0 0 * * *'", () => {
    expect(describeSchedule("0 0 * * *")).toBe("Daily midnight");
  });

  it("returns 'Weekdays 9am' for '0 9 * * 1-5'", () => {
    expect(describeSchedule("0 9 * * 1-5")).toBe("Weekdays 9am");
  });

  it("returns 'Weekly Mon' for '0 9 * * 1'", () => {
    expect(describeSchedule("0 9 * * 1")).toBe("Weekly Mon");
  });

  it("returns raw expression for unrecognized schedules", () => {
    expect(describeSchedule("*/15 * * * *")).toBe("*/15 * * * *");
  });
});
