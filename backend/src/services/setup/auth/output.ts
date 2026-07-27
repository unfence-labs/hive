/**
 * Reading terminal output from the agent CLIs.
 *
 * Both sign-in flows hand the operator a URL by printing it, and printed means
 * decorated: colours, cursor moves, and hyperlink escapes. Nothing here parses
 * a human-readable *label* — labels are what a CLI changes when it redesigns a
 * screen. These read the parts a terminal treats as data: the escape sequence
 * that carries a hyperlink target, and the URL itself.
 */

import { TOOL_OUTPUT_EXCERPT_MAX } from "@hive/shared/setup-types";

const ESC = "\u001b";
const BEL = "\u0007";

/** CSI: colours and cursor moves, e.g. `ESC [ 1 ; 32 m` or `ESC [ 12 G`. */
const CSI_RE = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g");

/** OSC: hyperlinks and window titles, terminated by BEL or `ESC \`. */
const OSC_RE = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, "g");

/**
 * OSC 8 hyperlink introducer: `ESC ] 8 ; <params> ; <uri>` up to its
 * terminator. The URI is the whole point — see {@link hyperlinkTargets}.
 */
const OSC8_RE = new RegExp(
  `${ESC}\\]8;[^;]*;([^${BEL}${ESC}]*)(?:${BEL}|${ESC}\\\\)`,
  "g",
);

const URL_RE = /https?:\/\/[^\s"'<>)\]]+/g;

/** Strip escape sequences and normalise CR so line-oriented reads are stable. */
export function stripAnsi(input: string): string {
  return input
    .replace(OSC_RE, "")
    .replace(CSI_RE, "")
    .replace(new RegExp(ESC, "g"), "")
    .replace(/\r/g, "\n");
}

/**
 * URIs carried by OSC 8 hyperlink sequences, in the order they appeared.
 *
 * This exists because the visible text is not the URL. A terminal wraps the
 * link's *label* at the pane width, so a long authorisation URL arrives as a
 * series of 80-column fragments — each one a valid-looking, useless prefix.
 * The OSC 8 parameter is the unwrapped target the terminal would actually
 * open, so it is the only faithful source. Must run before {@link stripAnsi},
 * which deletes these sequences along with every other escape.
 */
export function hyperlinkTargets(input: string): string[] {
  const targets: string[] = [];
  for (const match of input.matchAll(OSC8_RE)) {
    const uri = match[1]?.trim();
    if (uri) targets.push(uri);
  }
  return targets;
}

/**
 * The page the operator must open.
 *
 * Hyperlink targets win over scraped text for the wrapping reason above. Among
 * candidates, one whose path mentions authorisation is preferred over, say, a
 * documentation link printed in the same banner; failing that, the first URL
 * seen. Both CLIs print their sign-in link first, so "first" is a reasonable
 * last resort rather than a guess.
 */
export function parseVerificationUri(input: string): string | undefined {
  const candidates = [
    ...hyperlinkTargets(input),
    ...(stripAnsi(input).match(URL_RE) ?? []),
  ]
    .map((url) => url.replace(/[.,]+$/, ""))
    .filter((url) => /^https?:\/\//.test(url));
  if (candidates.length === 0) return undefined;
  return (
    candidates.find((url) => /device|oauth|authorize|login/i.test(url)) ?? candidates[0]
  );
}

/**
 * The one-time code for a device flow: two alphanumeric groups joined by a
 * hyphen, as both GitHub and Codex render them (`U927-TJEHB`).
 *
 * Deliberately not anchored to a label. It is matched against text with the
 * URLs removed, because an authorisation URL is full of hyphen-joined
 * alphanumerics that would otherwise match first.
 */
const DEVICE_CODE_RE = /\b([A-Z0-9]{4,8}-[A-Z0-9]{4,8})\b/;

export function parseDeviceCode(input: string): string | undefined {
  const clean = stripAnsi(input).replace(URL_RE, " ");
  const match = clean.match(DEVICE_CODE_RE);
  return match ? match[1].toUpperCase() : undefined;
}

/** Long-lived Claude tokens. Also the shape validated before anything is stored. */
export const CLAUDE_TOKEN_RE = /sk-ant-oat01-[A-Za-z0-9_-]{16,}/;

/**
 * Find the Claude token in terminal output.
 *
 * A second pass runs over the output with whitespace removed. The Claude CLI
 * positions words with cursor-column escapes rather than spaces, so a token it
 * prints can arrive split across what look like separate words; joining them
 * back up recovers it. The un-joined pass runs first so a normally-printed
 * token is never mangled by the fallback.
 */
export function parseClaudeToken(input: string): string | undefined {
  const clean = stripAnsi(input);
  for (const text of [clean, clean.replace(/\s+/g, "")]) {
    const match = text.match(CLAUDE_TOKEN_RE);
    if (match) return match[0];
  }
  return undefined;
}

/**
 * Remove anything credential-shaped, so output can be shown and logged.
 *
 * Matches loosely on purpose. A redactor that only recognises well-formed
 * credentials is one that leaks the malformed ones — and output arriving from
 * a terminal is exactly where a credential turns up truncated, wrapped, or
 * half-overwritten. Over-redacting costs a little diagnostic detail; under-
 * redacting writes a secret to a log.
 */
export function redactSecrets(input: string): string {
  return input
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "sk-ant-[redacted]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, "gh_[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-jwt]");
}

/**
 * The tail of command output, readable and safe to store: escapes removed,
 * blank lines dropped, credentials redacted, bounded to `maxLines` and to
 * {@link TOOL_OUTPUT_EXCERPT_MAX} characters. The tail rather than the head
 * because CLIs put the error last and the banner first.
 */
export function outputTail(input: string, maxLines = 12): string | undefined {
  const lines = redactSecrets(stripAnsi(input))
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const tail = lines.slice(-maxLines).join("\n");
  if (!tail) return undefined;
  if (tail.length <= TOOL_OUTPUT_EXCERPT_MAX) return tail;
  return `…${tail.slice(-TOOL_OUTPUT_EXCERPT_MAX)}`;
}
