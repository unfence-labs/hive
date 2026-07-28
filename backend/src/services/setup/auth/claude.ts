import type { ToolDetection } from "../detect.js";
import {
  ToolAuthError,
  isValidAuthorizationCode,
  type AuthFlow,
  type ToolAuthOutcome,
} from "./flow.js";
import {
  outputTail,
  parseClaudeToken,
  parseOAuthError,
  parseVerificationUri,
} from "./output.js";
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
 *
 * Output, not exit, decides the outcome. The CLI prints the token and then
 * lingers, and it answers a rejected code by printing why and waiting for
 * another one rather than by exiting — so a driver that only read the buffer
 * after the process was gone would sit silent through both.
 */

export interface ClaudeAuthDeps {
  detect: () => Promise<ToolDetection>;
  writeToken: ClaudeTokenWriter;
  spawn?: SpawnAuthProcess;
}

export function claudeAuthFlow(deps: ClaudeAuthDeps): AuthFlow {
  const spawn = deps.spawn ?? spawnPtyAuthProcess;

  return (ctx) => {
    let child: AuthProcess | null = null;
    let buffer = "";
    let cancelled = false;
    let settled = false;
    let awaitingCode = false;
    let codePending = false;
    let verificationUri: string | undefined;

    // Settled by the watcher below when the output alone decides the outcome.
    // Raced against the exit so whichever happens first is what is reported.
    let resolveFromOutput!: (outcome: ToolAuthOutcome) => void;
    let rejectFromOutput!: (error: unknown) => void;
    const fromOutput = new Promise<ToolAuthOutcome>((resolve, reject) => {
      resolveFromOutput = resolve;
      rejectFromOutput = reject;
    });

    function watch(active: AuthProcess): void {
      if (settled || cancelled) return;

      // The token is the credential. Once it is on screen the flow has
      // succeeded, whether or not the CLI has got round to exiting.
      const token = parseClaudeToken(buffer);
      if (isValidClaudeToken(token)) {
        settled = true;
        void deps.writeToken(token).then(
          () => {
            active.kill();
            resolveFromOutput("connected");
          },
          (error: unknown) => {
            active.kill();
            rejectFromOutput(error);
          },
        );
        return;
      }

      // A code the provider refused. The CLI stays alive and offers a retry on
      // the same link, so the operator gets another go without repeating the
      // browser step — pressing return for them is what re-opens the prompt.
      if (codePending) {
        const oauthError = parseOAuthError(buffer);
        if (oauthError) {
          codePending = false;
          // The refused attempt's output is history, and leaving it in the
          // buffer would make the next submission match this same complaint.
          buffer = "";
          ctx.prompt({
            verificationUri: verificationUri ?? "",
            needsCode: true,
            notice: oauthError,
          });
          active.write("\r");
          return;
        }
      }

      if (awaitingCode) return;
      // The link appearing is the flow becoming actionable. The CLI's own
      // "paste code here" prompt is not used as the trigger: it is drawn with
      // cursor-positioning escapes rather than spaces, so matching it would
      // mean matching a rendering rather than a fact.
      const uri = parseVerificationUri(buffer);
      if (!uri) return;
      awaitingCode = true;
      verificationUri = uri;
      ctx.prompt({ verificationUri: uri, needsCode: true });
    }

    async function afterExit(code: number, before: ToolDetection): Promise<ToolAuthOutcome> {
      if (cancelled) return "cancelled";

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

      if (code !== 0) {
        throw new ToolAuthError(
          "command_failed",
          `Claude sign-in exited with code ${code}.`,
          { outputExcerpt: outputTail(buffer) },
        );
      }
      throw new ToolAuthError(
        "no_credential",
        "Claude sign-in finished without producing a token.",
        { outputExcerpt: outputTail(buffer) },
      );
    }

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
        watch(active);
      });

      return await Promise.race([
        fromOutput,
        active.exit.then((code) => (settled ? fromOutput : afterExit(code, before))),
      ]);
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
        codePending = true;
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
