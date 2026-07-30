import { execFile } from "node:child_process";
import { gh, _resetGhState } from "../../../utils/github.js";
import { ensureGitIdentity } from "../../../utils/git-identity.js";
import type { ToolDetection } from "../detect.js";
import { ToolAuthError, type AuthFlow, type ToolAuthOutcome } from "./flow.js";

/**
 * GitHub sign-in.
 *
 * There is no CLI process to supervise here: Hive speaks GitHub's device-code
 * endpoints itself — ask for a code, surface it, poll the token endpoint at
 * the pace GitHub sets — and only involves the `gh` CLI once a token exists,
 * to store it and point git's credential helper at it.
 */

// Default OAuth App client_id for Hive (public, not a secret).
// Override with GITHUB_CLIENT_ID env var for self-hosted instances.
const DEFAULT_CLIENT_ID = "Ov23livbVN5QHEParafr";

/**
 * Scopes the token must carry.
 *
 * - `repo` covers cloning, pushing, and the pull-request and issue calls the
 *   workspace flows make against private repositories.
 * - `workflow` is separate from `repo` at GitHub's end: without it a push is
 *   rejected outright when the branch touches `.github/workflows`, which is a
 *   thing agents editing a repository do.
 * - `read:org` is what `gh` needs to see organisation repositories and to
 *   satisfy SAML single sign-on.
 * - `read:user` and `user:email` back the connected-account card.
 *
 * `delete_repo` is deliberately absent. Only the cleanup path that removes a
 * repository Hive itself just created would use it, and asking every operator
 * to grant repository deletion to service that is a bad trade; that cleanup
 * reports its failure instead.
 */
const OAUTH_SCOPES = "repo workflow read:user user:email read:org";

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";

/** GitHub's polling pace when it does not say otherwise, in seconds. */
const DEFAULT_INTERVAL_S = 5;

interface GitHubOAuthResponse {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  expires_in?: number;
  interval?: number;
  access_token?: string;
  error?: string;
  error_description?: string;
}

async function callGitHub(
  fetchFn: typeof globalThis.fetch,
  url: string,
  body: Record<string, string>,
): Promise<GitHubOAuthResponse> {
  const res = await fetchFn(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new ToolAuthError("command_failed", `GitHub API error: ${await res.text()}`);
  }
  return (await res.json()) as GitHubOAuthResponse;
}

/** Sign the CLI in. The token travels over stdin, never argv, where `ps` could see it. */
async function loginWithToken(token: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = execFile(
      "gh",
      ["auth", "login", "--hostname", "github.com", "--with-token"],
      (err) => {
        if (err) {
          const stderr = (err as unknown as { stderr?: string }).stderr ?? "";
          reject(
            new ToolAuthError("command_failed", "Signing the GitHub CLI in failed.", {
              outputExcerpt: stderr || err.message,
            }),
          );
        } else {
          resolve();
        }
      },
    );
    child.stdin?.write(token + "\n");
    child.stdin?.end();
  });
}

/**
 * Point git at the GitHub CLI's credentials.
 *
 * By this point the token is stored and `gh` is genuinely signed in, and the
 * tools panel will keep reporting that. The failure is still surfaced as one
 * rather than dropped: saying nothing would leave the operator to discover it
 * as an unexplained push failure later.
 */
async function setupGitCredentials(): Promise<void> {
  try {
    await gh(["config", "set", "git_protocol", "https", "--host", "github.com"]);
    await gh(["auth", "setup-git", "--hostname", "github.com"]);
  } catch (err: unknown) {
    const detail =
      (err as { stderr?: string }).stderr?.trim() || (err as Error).message;
    throw new ToolAuthError(
      "command_failed",
      `GitHub is connected, but configuring git credentials failed: ${detail}`,
    );
  }
}

export interface GitHubAuthDeps {
  detect: () => Promise<ToolDetection>;
  fetch?: typeof globalThis.fetch;
  /** Test seam for the polling pace; resolves after `ms`. */
  sleep?: (ms: number) => Promise<void>;
}

export function githubAuthFlow(deps: GitHubAuthDeps): AuthFlow {
  const fetchFn = deps.fetch ?? globalThis.fetch;

  return (ctx) => {
    let cancelled = false;
    let wake: () => void = () => {};
    const interrupted = new Promise<void>((resolve) => {
      wake = resolve;
    });
    const sleep =
      deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    // A cancel must not sit out a poll pause that can be ten seconds long.
    const pause = (ms: number): Promise<void> => Promise.race([sleep(ms), interrupted]);

    const done = (async (): Promise<ToolAuthOutcome> => {
      const before = await deps.detect();
      if (!before.installed) {
        throw new ToolAuthError(
          "not_installed",
          "The GitHub CLI is not installed on this server.",
        );
      }
      if (cancelled) return "cancelled";

      const clientId = process.env.GITHUB_CLIENT_ID?.trim() || DEFAULT_CLIENT_ID;
      const start = await callGitHub(fetchFn, DEVICE_CODE_URL, {
        client_id: clientId,
        scope: OAUTH_SCOPES,
      });
      if (start.error) {
        throw new ToolAuthError("command_failed", start.error_description ?? start.error);
      }
      if (!start.device_code || !start.user_code || !start.verification_uri) {
        throw new ToolAuthError(
          "command_failed",
          "GitHub's device-code response was incomplete.",
        );
      }

      let intervalS = start.interval || DEFAULT_INTERVAL_S;
      const expiresAt = Date.now() + (start.expires_in ?? 900) * 1000;
      ctx.prompt({
        verificationUri: start.verification_uri,
        userCode: start.user_code,
        expiresAt: new Date(expiresAt),
      });

      for (;;) {
        await pause(intervalS * 1000);
        if (cancelled) return "cancelled";
        if (Date.now() > expiresAt) return "expired";

        const poll = await callGitHub(fetchFn, ACCESS_TOKEN_URL, {
          client_id: clientId,
          device_code: start.device_code,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        });
        if (poll.error === "authorization_pending") continue;
        if (poll.error === "slow_down") {
          // GitHub rations this endpoint; obey the pace it asks for.
          if (poll.interval) intervalS = poll.interval;
          continue;
        }
        if (poll.error === "expired_token") return "expired";
        // The operator said no on GitHub's page. A refusal is not a malfunction.
        if (poll.error === "access_denied") return "cancelled";
        if (poll.error) {
          throw new ToolAuthError("command_failed", poll.error_description ?? poll.error);
        }
        if (!poll.access_token) {
          throw new ToolAuthError(
            "no_credential",
            "GitHub's response carried no access token.",
          );
        }

        ctx.setState("verifying");
        await loginWithToken(poll.access_token);
        _resetGhState();
        await setupGitCredentials();
        // Upgrade the global git identity to this account now that it is known,
        // unless the operator has set their own. A failure here must not fail an
        // otherwise-successful sign-in.
        await ensureGitIdentity().catch(() => {});
        return "connected";
      }
    })();

    return {
      done,
      submitCode: () => {
        throw new Error("GitHub confirms the code in the browser; there is nothing to paste back.");
      },
      cancel: () => {
        cancelled = true;
        wake();
      },
    };
  };
}
