import { describe, expect, it } from "vitest";
import {
  CLAUDE_OAUTH_ERROR_PTY,
  CLAUDE_SETUP_TOKEN_PTY,
  CODEX_DEVICE_AUTH_STDOUT,
} from "./__fixtures__/cli-output.js";
import {
  hyperlinkTargets,
  outputTail,
  parseClaudeToken,
  parseDeviceCode,
  parseOAuthError,
  parseVerificationUri,
  redactSecrets,
  stripAnsi,
} from "./output.js";

describe("codex device-auth output", () => {
  it("recovers the verification link and the one-time code", () => {
    expect(parseVerificationUri(CODEX_DEVICE_AUTH_STDOUT)).toBe(
      "https://auth.openai.com/codex/device",
    );
    expect(parseDeviceCode(CODEX_DEVICE_AUTH_STDOUT)).toBe("U927-TJEHB");
  });

  it("reads neither before the CLI has printed them", () => {
    const banner = CODEX_DEVICE_AUTH_STDOUT.slice(
      0,
      CODEX_DEVICE_AUTH_STDOUT.indexOf("Follow these steps"),
    );
    expect(parseVerificationUri(banner)).toBeUndefined();
    expect(parseDeviceCode(banner)).toBeUndefined();
  });

  it("does not mistake the CLI's own version banner for a device code", () => {
    expect(parseDeviceCode("Welcome to Codex [v0.145.0]")).toBeUndefined();
  });
});

describe("claude setup-token output", () => {
  it("recovers the whole authorisation URL from the hyperlink target", () => {
    const url = parseVerificationUri(CLAUDE_SETUP_TOKEN_PTY);
    expect(url).toContain("https://claude.com/cai/oauth/authorize");
    // The part that proves the wrapping was survived: `state` is the last
    // parameter, so a URL scraped from the wrapped visible text stops short.
    expect(url).toMatch(/[?&]state=[A-Za-z0-9_-]+$/);
    expect(url).not.toContain("\n");
  });

  it("is not fooled by the wrapped visible label", () => {
    // What scraping the drawn text gets you: the first 80-column fragment, a
    // URL that parses and resolves to nothing. The hyperlink target is longer
    // because it is the whole thing.
    const url = parseVerificationUri(CLAUDE_SETUP_TOKEN_PTY) ?? "";
    const [scraped = ""] = stripAnsi(CLAUDE_SETUP_TOKEN_PTY).match(/https?:\/\/\S+/g) ?? [];

    expect(scraped).toMatch(/^https:\/\/claude\.com\/cai\/oauth\/authorize/);
    expect(scraped).not.toContain("state=");
    expect(url.length).toBeGreaterThan(scraped.length);
    expect(url.startsWith(scraped)).toBe(true);
  });

  it("exposes the hyperlink targets it read", () => {
    expect(hyperlinkTargets(CLAUDE_SETUP_TOKEN_PTY).length).toBeGreaterThan(0);
  });

  it("finds a token the terminal wrapped across a line break", () => {
    const token = "sk-ant-oat01-AbC123_dEf456-GhI789jkl";
    const [head, tail] = [token.slice(0, 14), token.slice(14)];
    // A pane narrower than the token: the wrap lands inside it.
    const drawn = `\u001b[37m${head}\r\n${tail}\u001b[39m`;

    expect(stripAnsi(drawn)).not.toContain(token);
    expect(parseClaudeToken(drawn)).toBe(token);
  });

  it("finds a normally printed token without joining anything", () => {
    const token = "sk-ant-oat01-PlainlyPrinted_Token-1234";
    expect(parseClaudeToken(`Your token:\n  ${token}\n`)).toBe(token);
  });

  it("returns nothing when no token was printed", () => {
    expect(parseClaudeToken(CLAUDE_SETUP_TOKEN_PTY)).toBeUndefined();
  });
});

describe("rejected codes", () => {
  it("reads the provider's complaint out of the drawn screen", () => {
    expect(parseOAuthError(CLAUDE_OAUTH_ERROR_PTY)).toBe(
      "Invalid code. Please make sure the full code was copied",
    );
  });

  it("leaves the CLI's retry instruction out of the operator's message", () => {
    expect(parseOAuthError("OAuth error: Invalid code. Press Enter to retry.")).toBe(
      "Invalid code.",
    );
  });

  it("reports the most recent complaint, not the one before it", () => {
    const buffer = "OAuth error: Invalid code\n...\nOAuth error: Code expired\n";
    expect(parseOAuthError(buffer)).toBe("Code expired");
  });

  it("reads nothing from output the CLI has not complained in", () => {
    expect(parseOAuthError(CLAUDE_SETUP_TOKEN_PTY)).toBeUndefined();
    // A label with nothing after it says nothing an operator could act on.
    expect(parseOAuthError("OAuth error:   \n")).toBeUndefined();
  });
});

describe("redaction", () => {
  it("removes credentials from output that is about to be shown or stored", () => {
    const text = [
      "token: sk-ant-oat01-AbC123_dEf456-GhI789jkl",
      "gh: ghp_0123456789abcdefghijABCDEFGHIJ",
    ].join("\n");

    const redacted = redactSecrets(text);

    expect(redacted).not.toContain("sk-ant-oat01-AbC123");
    expect(redacted).not.toContain("ghp_0123456789abcdefghijABCDEFGHIJ");
    expect(redacted).toContain("sk-ant-[redacted]");
  });

  it("redacts the tail it reports on failure", () => {
    const tail = outputTail("boom\nsk-ant-oat01-AbC123_dEf456-GhI789jkl\n") ?? "";
    expect(tail).toContain("boom");
    expect(tail).not.toContain("AbC123");
  });

  it("keeps only the last lines and drops the blank ones", () => {
    const tail = outputTail("a\n\n\nb\nc\nd\n", 2);
    expect(tail).toBe("c\nd");
  });

  it("reports nothing rather than an empty string for silent output", () => {
    expect(outputTail("\u001b[2J\u001b[H  \n\n")).toBeUndefined();
  });
});
