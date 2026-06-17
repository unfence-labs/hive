import { interpolatePromptVariables } from "../agents/system-prompt.js";
import type { Agent } from "../types.js";

/**
 * Always-on instruction appended to every agent-driven run's system prompt.
 * It powers the completion notification by asking the agent to end with a
 * "## Summary" section, which the summary extractor reads.
 */
export const SUMMARY_INSTRUCTION =
  "\n\nIMPORTANT: End your final message with a \"## Summary\" section that concisely summarizes your findings and actions. This summary will be sent as a notification.";

export interface ComposeAgentRunPromptInput {
  agent: Agent;
  /**
   * Pre-built git context block, or null when git context must be omitted
   * (agent has `injectGitContext` disabled, or the automation is not
   * project-linked). Kept out of this pure function so it stays unit-testable;
   * the caller gathers git context and passes the formatted block in.
   */
  gitContextBlock: string | null;
  /** Values used to interpolate `{PROJECT}`, `{DIR}`, `{DEFAULT_BRANCH}` placeholders. */
  interpolation: {
    projectName: string;
    cwd: string;
    defaultBranch: string;
  };
}

/**
 * Compose the resolved system prompt for an agent-driven automation run.
 *
 * Deterministic and pure: fixed order is
 *   agent.systemPrompt → git context block (if provided) → SUMMARY_INSTRUCTION.
 * Template variables are interpolated last so they apply to the agent prompt
 * (the git block is already concrete and the summary instruction is static).
 */
export function composeAgentRunPrompt(input: ComposeAgentRunPromptInput): string {
  const { agent, gitContextBlock, interpolation } = input;

  const sections: string[] = [agent.systemPrompt];
  if (gitContextBlock) sections.push(gitContextBlock);

  const composed = interpolatePromptVariables(sections.join("\n\n"), interpolation);
  return composed + SUMMARY_INSTRUCTION;
}
