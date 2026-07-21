/**
 * Device-auth output parsers for the gh and codex CLIs. Kept in one place so
 * the regexes are snapshot-testable against captured fixture output.
 */

/** Strip ANSI/OSC escape sequences and normalise CR so line parsing is stable. */
export function stripAnsi(input: string): string {
  const ESC = "\u001b";
  const BEL = "\u0007";
  return (
    input
      // CSI sequences (colours, cursor moves): ESC [ ... final-byte
      .replace(new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g"), "")
      // OSC sequences (hyperlinks/titles): ESC ] ... (BEL | ESC \\)
      .replace(new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, "g"), "")
      // Any remaining lone escape byte.
      .replace(new RegExp(ESC, "g"), "")
      .replace(/\r/g, "\n")
  );
}

/**
 * Device one-time code: two groups of alphanumerics joined by a hyphen, e.g.
 * `ABCD-1234`. gh renders it as `First copy your one-time code: XXXX-XXXX`;
 * codex prints a bare `XXXX-XXXX`. We accept 4-8 chars per group to be liberal.
 */
const DEVICE_CODE_RE = /\b([A-Z0-9]{4,8}-[A-Z0-9]{4,8})\b/;

/** First https URL on the buffer. Used to scrape the device-activation URL. */
const URL_RE = /https?:\/\/[^\s"'<>)\]]+/g;

export function parseDeviceCode(text: string): string | undefined {
  const clean = stripAnsi(text);
  // Prefer an explicit "one-time code:" label when present (gh), else any match.
  const labelled = clean.match(/one-time code:\s*([A-Z0-9]{4,8}-[A-Z0-9]{4,8})/i);
  if (labelled) return labelled[1].toUpperCase();
  const m = clean.match(DEVICE_CODE_RE);
  return m ? m[1].toUpperCase() : undefined;
}

/**
 * Scrape the device-activation URL. gh uses `https://github.com/login/device`.
 * codex has at least two variants (`.../device` and `.../codex/device`) so we
 * do NOT hardcode — we prefer a URL whose path contains "device", else the
 * first URL seen.
 */
export function parseDeviceUrl(text: string): string | undefined {
  const clean = stripAnsi(text);
  const urls = clean.match(URL_RE);
  if (!urls || urls.length === 0) return undefined;
  const trimmed = urls.map((u) => u.replace(/[.,]+$/, ""));
  const deviceUrl = trimmed.find((u) => /device/i.test(u));
  return deviceUrl ?? trimmed[0];
}

// --- Success / error signals ---

/** codex prints a success line and/or writes auth.json. */
export function isCodexLoggedIn(text: string): boolean {
  const clean = stripAnsi(text);
  return (
    /Successfully logged in/i.test(clean) ||
    /Logged in( to ChatGPT)?/i.test(clean) ||
    /Authentication (complete|successful)/i.test(clean)
  );
}

/**
 * codex refuses device-code auth when the ChatGPT workspace has it disabled.
 * Detecting this maps to CODEX_DEVICE_AUTH_DISABLED so the wizard can tell the
 * user to enable it in workspace settings.
 */
export function isCodexDeviceAuthDisabled(text: string): boolean {
  const clean = stripAnsi(text);
  return (
    /contact your workspace admin to enable device code authentication/i.test(clean) ||
    /device code (login|authentication) is (disabled|not enabled)/i.test(clean)
  );
}

/** A generic "code expired / please retry" signal shared by both flows. */
export function isDeviceCodeExpired(text: string): boolean {
  const clean = stripAnsi(text);
  return /expired/i.test(clean) && /code/i.test(clean);
}
