import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("Tauri Info.plist", () => {
  it("allows HTTP connections via ATS override", async () => {
    const plist = await readFile(
      join(process.cwd(), "src-tauri", "Info.plist"),
      "utf-8",
    );

    expect(plist).toContain("<key>NSAppTransportSecurity</key>");
    expect(plist).toContain("<key>NSAllowsArbitraryLoads</key>");
    expect(plist).toContain("<true/>");
  });
});
