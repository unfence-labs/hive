import type { ToolAuthFailureReason, ToolAuthState } from "@hive/shared/setup-types";
import { TOOL_OUTPUT_EXCERPT_MAX } from "@hive/shared/setup-types";

/**
 * How a sign-in ended when it ended without malfunctioning.
 *
 * Expiry and cancellation are outcomes rather than errors on purpose: a code
 * that ran out and an operator who changed their mind are both things the
 * system did correctly, and reporting them as failures would bury the ones
 * that are not.
 */
export type ToolAuthOutcome = "connected" | "expired" | "cancelled";

/** A sign-in that malfunctioned, carrying what the operator should do about it. */
export class ToolAuthError extends Error {
  readonly reason: ToolAuthFailureReason;
  readonly outputExcerpt?: string;

  constructor(
    reason: ToolAuthFailureReason,
    message: string,
    opts: { outputExcerpt?: string } = {},
  ) {
    super(message);
    this.name = "ToolAuthError";
    this.reason = reason;
    this.outputExcerpt = opts.outputExcerpt?.slice(0, TOOL_OUTPUT_EXCERPT_MAX);
  }
}

/** What the operator has to do, discovered by watching the CLI's output. */
export interface AuthorizationPrompt {
  verificationUri: string;
  /** One-time code to enter at the verification page, for device flows. */
  userCode?: string;
  expiresAt?: Date;
  /**
   * True when the flow additionally needs that code handed back to it. The
   * browser tells Codex directly; Claude prints a code the operator must
   * return through Hive.
   */
  needsCode?: boolean;
}

export interface AuthFlowContext {
  /** Publish what the operator must do. Safe to call repeatedly. */
  prompt: (info: AuthorizationPrompt) => void;
  setState: (state: ToolAuthState) => void;
}

export interface AuthFlowHandle {
  /** Settles once the flow is over. Rejects only with {@link ToolAuthError}. */
  done: Promise<ToolAuthOutcome>;
  /** Hand a code to a flow that is waiting for one. */
  submitCode: (code: string) => void;
  /** Stop the flow and undo anything starting it disturbed. */
  cancel: () => void;
}

export type AuthFlow = (ctx: AuthFlowContext) => AuthFlowHandle;

/**
 * A code pasted back by the operator, before it reaches a CLI's stdin.
 *
 * Deliberately permissive about which characters providers use and strict
 * about everything else: no newlines (which would submit trailing junk as a
 * second answer to whatever prompt comes next) and a bounded length.
 */
const AUTHORIZATION_CODE_RE = /^[A-Za-z0-9._~+/=@:%#?&-]{4,2048}$/;

export function isValidAuthorizationCode(code: string): boolean {
  return AUTHORIZATION_CODE_RE.test(code);
}
