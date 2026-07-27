import type { ToolDetection } from "../detect.js";
import {
  ToolAuthError,
  isValidAuthorizationCode,
  type AuthFlow,
  type ToolAuthOutcome,
} from "./flow.js";
import { outputTail, parseClaudeToken, parseVerificationUri } from "./output.js";
import { spawnPtyAuthProcess, type AuthProcess, type SpawnAuthProcess } from "./process.js";
import { isValidClaudeToken, type ClaudeTokenWriter } from "./secrets.js";

/**
 * Claude sign-in.
 *
 * `claude setup-token` refuses to run without a terminal, opens a browser, and
 * waits for an authorisation code to be typed back at it. There is no HTTP
 * equivalent to call instead, so this drives the CLI through a pseudo-terminal
 * and relays both halves: the link out to the operator, the code back in.
 *
 * The token it prints is the credential. It is validated, stored by
 * `secrets.ts`, and never reaches a command line — the code travels over the
 * terminal's stdin, and the token is only ever read out of output that is
 * redacted before anything else can see it.
 */

/** How long the link stays worth opening before the attempt is abandoned. */
const DEFAULT_TIMEOUT_MS = 15 * 60_000;

export interface ClaudeAuthDeps {
  detect: () => Promise<ToolDetection>;
  writeToken: ClaudeTokenWriter;
  spawn?: SpawnAuthProcess;
  timeoutMs?: number;
}

type RaceResult = { kind: "exit"; code: number } | { kind: "timeout" };

function raceExit(process: AuthProcess, timeoutMs: number): Promise<RaceResult> {
  return new Promise<RaceResult>((resolve) => {
    const timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
    timer.unref?.();
    void process.exit.then((code) => {
      clearTimeout(timer);
      resolve({ kind: "exit", code });
    });
  });
}

export function claudeAuthFlow(deps: ClaudeAuthDeps): AuthFlow {
  const spawn = deps.spawn ?? spawnPtyAuthProcess;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return (ctx) => {
    let child: AuthProcess | null = null;
    let buffer = "";
    let cancelled = false;
    let awaitingCode = false;
    let codeSubmitted = false;

    const done = (async (): Promise<ToolAuthOutcome> => {
      const before = await deps.detect();
      if (!before.installed) {
        throw new ToolAuthError(
          "not_installed",
          "Claude Code is not installed on this server.",
        );
      }
      if (cancelled) return "cancelled";

      child = spawn("claude", ["setup-token"]);
      const active = child;
      active.onData((chunk) => {
        buffer += chunk;
        if (awaitingCode) return;
        // The link appearing is the flow becoming actionable. The CLI's own
        // "paste code here" prompt is not used as the trigger: it is drawn with
        // cursor-positioning escapes rather than spaces, so matching it would
        // mean matching a rendering rather than a fact.
        const verificationUri = parseVerificationUri(buffer);
        if (!verificationUri) return;
        awaitingCode = true;
        ctx.prompt({
          verificationUri,
          needsCode: true,
          expiresAt: new Date(Date.now() + timeoutMs),
        });
      });

      const result = await raceExit(active, timeoutMs);
      if (cancelled) {
        active.kill();
        return "cancelled";
      }

      if (result.kind === "timeout") {
        active.kill();
        // Nobody came back with a code: the link went stale, which is not a
        // malfunction. Having submitted one and still be waiting is.
        if (!codeSubmitted) return "expired";
        throw new ToolAuthError(
          "timeout",
          "Claude did not finish signing in after the code was submitted.",
          { outputExcerpt: outputTail(buffer) },
        );
      }

      const token = parseClaudeToken(buffer);
      if (isValidClaudeToken(token)) {
        await deps.writeToken(token);
        return "connected";
      }

      // The CLI may have persisted a session of its own. Only trusted when
      // Claude was not already signed in before this ran — otherwise the probe
      // would be answering about the credential this attempt was replacing.
      if (!before.authenticated) {
        const after = await deps.detect();
        if (after.authenticated) return "connected";
      }

      if (result.code !== 0) {
        throw new ToolAuthError(
          "command_failed",
          `Claude sign-in exited with code ${result.code}.`,
          { outputExcerpt: outputTail(buffer) },
        );
      }
      throw new ToolAuthError(
        "no_credential",
        "Claude sign-in finished without producing a token.",
        { outputExcerpt: outputTail(buffer) },
      );
    })();

    return {
      done,
      submitCode: (code) => {
        if (!awaitingCode || !child) {
          throw new Error("Claude sign-in is not waiting for a code yet.");
        }
        if (!isValidAuthorizationCode(code)) {
          throw new Error("That does not look like an authorization code.");
        }
        codeSubmitted = true;
        child.write(`${code}\r`);
        ctx.setState("verifying");
      },
      cancel: () => {
        cancelled = true;
        child?.kill();
      },
    };
  };
}
