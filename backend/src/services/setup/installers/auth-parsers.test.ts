import { describe, it, expect } from "vitest";
import {
  stripAnsi,
  parseDeviceCode,
  parseDeviceUrl,
  isCodexDeviceAuthDisabled,
  isDeviceCodeExpired,
} from "./auth-parsers.js";

describe("stripAnsi", () => {
  it("removes CSI colour codes and normalises CR", () => {
    const input = "[32m✓[0m Logged in\r\n";
    expect(stripAnsi(input)).toContain("Logged in");
    expect(stripAnsi(input)).not.toContain("");
  });
});

describe("parseDeviceCode", () => {
  it("extracts a labelled gh one-time code", () => {
    expect(parseDeviceCode("First copy your one-time code: AB12-CD34")).toBe("AB12-CD34");
  });

  it("extracts a bare XXXX-XXXX codex code", () => {
    expect(parseDeviceCode("Enter the code: QWER-7890")).toBe("QWER-7890");
  });

  it("uppercases lowercased codes", () => {
    expect(parseDeviceCode("one-time code: ab12-cd34")).toBe("AB12-CD34");
  });

  it("returns undefined when no code present", () => {
    expect(parseDeviceCode("Waiting for authentication...")).toBeUndefined();
  });
});

describe("parseDeviceUrl", () => {
  it("extracts the gh device URL", () => {
    expect(parseDeviceUrl("open https://github.com/login/device in your browser")).toBe(
      "https://github.com/login/device",
    );
  });

  it("prefers a device-path URL over an unrelated one", () => {
    const text = "docs at https://example.com/help then https://auth.openai.com/codex/device";
    expect(parseDeviceUrl(text)).toBe("https://auth.openai.com/codex/device");
  });

  it("handles the /device codex variant (not hardcoded)", () => {
    expect(parseDeviceUrl("Visit https://auth.openai.com/device and enter code")).toBe(
      "https://auth.openai.com/device",
    );
  });

  it("strips trailing punctuation", () => {
    expect(parseDeviceUrl("go to https://github.com/login/device.")).toBe(
      "https://github.com/login/device",
    );
  });
});

describe("error signals", () => {
  it("detects codex device-auth disabled", () => {
    expect(
      isCodexDeviceAuthDisabled(
        "Please contact your workspace admin to enable device code authentication.",
      ),
    ).toBe(true);
    expect(isCodexDeviceAuthDisabled("all good")).toBe(false);
  });

  it("detects expiry", () => {
    expect(isDeviceCodeExpired("The one-time code has expired.")).toBe(true);
    expect(isDeviceCodeExpired("still valid")).toBe(false);
  });
});
