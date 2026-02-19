import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("Tauri default capability", () => {
  it("allows VS Code URI schemes for opener plugin", async () => {
    const capabilityRaw = await readFile(
      join(process.cwd(), "src-tauri", "capabilities", "default.json"),
      "utf-8",
    );
    const capability = JSON.parse(capabilityRaw) as {
      permissions: Array<string | { identifier: string; allow?: Array<{ url?: string }> }>;
    };

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
});
