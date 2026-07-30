import type { ToolDetection } from "../detect.js";
import {
  ToolAuthError,
  isValidAuthorizationCode,
  type AuthFlow,
  type ToolAuthOutcome,
} from "./flow.js";
import {
  outputTail,
  parseOAuthError,
  parseVerificationUri,
} from "./output.js";
import { spawnPtyAuthProcess, type AuthProcess, type SpawnAuthProcess } from "./process.js";

/**
 * Claude sign-in.
 *
 * `claude auth login --claudeai` opens a browser and waits for an authorisation
 * code to be typed back at it. Hive drives the CLI through a pseudo-terminal
 * and relays both halves: the link out to the operator, the code back in.
 *
 * Claude Code owns the resulting credential, including refresh. Hive never
 * copies or persists OAuth tokens itself. This also gives account features
 * such as usage polling the full `user:profile` scope that long-lived
 * inference-only setup tokens deliberately omit.
 */

export interface ClaudeAuthDeps {
  detect: () => Promise<ToolDetection>;
  spawn?: SpawnAuthProcess;
}

export function claudeAuthFlow(deps: ClaudeAuthDeps): AuthFlow {
  const spawn = deps.spawn ?? spawnPtyAuthProcess;

  return (ctx) => {
    let child: AuthProcess | null = null;
    let buffer = "";
    let cancelled = false;
    let awaitingCode = false;
    let codePending = false;
    let verificationUri: string | undefined;

    function watch(active: AuthProcess): void {
      if (cancelled) return;

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

    async function afterExit(code: number): Promise<ToolAuthOutcome> {
      if (cancelled) return "cancelled";

      if (code !== 0) {
        throw new ToolAuthError(
          "command_failed",
          `Claude sign-in exited with code ${code}.`,
          { outputExcerpt: outputTail(buffer) },
        );
      }

      const after = await deps.detect();
      if (after.authenticated) return "connected";

      throw new ToolAuthError(
        "no_credential",
        "Claude sign-in finished without saving a usable credential.",
        { outputExcerpt: outputTail(buffer) },
      );
    }

    const done = (async (): Promise<ToolAuthOutcome> => {
      const current = await deps.detect();
      if (!current.installed) {
        throw new ToolAuthError(
          "not_installed",
          "Claude Code is not installed on this server.",
        );
      }
      if (cancelled) return "cancelled";

      child = spawn("claude", ["auth", "login", "--claudeai"]);
      const active = child;
      active.onData((chunk) => {
        buffer += chunk;
        watch(active);
      });

      return afterExit(await active.exit);
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
        // The return is a separate write on purpose. The CLI's terminal UI
        // treats a chunk with the return inside it as one paste and swallows
        // the keystroke — the code then sits in the input field forever.
        // Delivered as its own chunk a beat later, it registers as Enter.
        // Reproduced against claude 2.1.220 with real-length (87+ char) codes;
        // short codes happened to survive the single write, which is why this
        // took a forensic trace to find.
        const active = child;
        active.write(code);
        setTimeout(() => {
          if (!cancelled) active.write("\r");
        }, 50);
        ctx.setState("verifying");
      },
      cancel: () => {
        cancelled = true;
        // A sign-in the operator gave up on, after handing a code over, hung
        // without printing anything the watcher recognises. The redacted tail
        // is the only forensic window into what the CLI was showing instead.
        if (codePending) {
          console.warn(
            `[claude-auth] cancelled while verifying; CLI tail:\n${outputTail(buffer)}`,
          );
        }
        child?.kill();
      },
    };
  };
}
