import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("Tauri default capability", () => {
  let capability: {
    permissions: Array<string | { identifier: string; allow?: Array<{ url?: string }> }>;
  };

  // Load the capability file once
  async function loadCapability() {
    if (capability) return;
    const capabilityRaw = await readFile(
      join(process.cwd(), "src-tauri", "capabilities", "default.json"),
      "utf-8",
    );
    capability = JSON.parse(capabilityRaw);
  }

  it("allows VS Code URI schemes for opener plugin", async () => {
    await loadCapability();

    const openerAllowRule = capability.permissions.find(
      (permission): permission is { identifier: string; allow: Array<{ url?: string }> } =>
        typeof permission === "object" && permission.identifier === "opener:allow-open-url",
    );

    expect(openerAllowRule).toBeDefined();
    expect(openerAllowRule?.allow).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: "vscode:*" }),
        expect.objectContaining({ url: "vscode-insiders:*" }),
      ]),
    );
  });

  it("allows exactly two VS Code URL patterns (no extras)", async () => {
    await loadCapability();

    const openerAllowRule = capability.permissions.find(
      (permission): permission is { identifier: string; allow: Array<{ url?: string }> } =>
        typeof permission === "object" && permission.identifier === "opener:allow-open-url",
    );

    expect(openerAllowRule?.allow).toHaveLength(2);
  });

  it("includes core:default and opener:default permissions", async () => {
    await loadCapability();

    const stringPermissions = capability.permissions.filter((p) => typeof p === "string");
    expect(stringPermissions).toContain("core:default");
    expect(stringPermissions).toContain("opener:default");
  });

  it("includes core:window drag permissions", async () => {
    await loadCapability();

    const stringPermissions = capability.permissions.filter((p) => typeof p === "string");
    expect(stringPermissions).toContain("core:window:allow-start-dragging");
    expect(stringPermissions).toContain("core:window:allow-start-resize-dragging");
  });

  it("opener:allow-open-url uses wildcard patterns for VS Code schemes", async () => {
    await loadCapability();

    const openerAllowRule = capability.permissions.find(
      (permission): permission is { identifier: string; allow: Array<{ url?: string }> } =>
        typeof permission === "object" && permission.identifier === "opener:allow-open-url",
    );

    // Both patterns should use wildcard to allow any VS Code URI path
    for (const entry of openerAllowRule?.allow ?? []) {
      expect(entry.url).toMatch(/^vscode(-insiders)?:\*$/);
    }
  });
});
