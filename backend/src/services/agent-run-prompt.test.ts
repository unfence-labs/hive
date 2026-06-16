import { describe, it, expect } from "vitest";
import { composeAgentRunPrompt, SUMMARY_INSTRUCTION } from "./agent-run-prompt.js";
import type { Agent } from "../types.js";

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    name: "Reviewer",
    systemPrompt: "You are a reviewer.",
    modelId: "claude:opus-4-8",
    injectGitContext: true,
    readOnly: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const interpolation = { projectName: "My App", cwd: "/ws", defaultBranch: "main" };

describe("composeAgentRunPrompt", () => {
  it("composes in fixed order: agent prompt → git block → summary", () => {
    const result = composeAgentRunPrompt({
      agent: makeAgent(),
      gitContextBlock: "# Git Context\n\nProject: My App",
      interpolation,
    });

    const agentIdx = result.indexOf("You are a reviewer.");
    const gitIdx = result.indexOf("# Git Context");
    const summaryIdx = result.indexOf("## Summary");

    expect(agentIdx).toBeGreaterThanOrEqual(0);
    expect(gitIdx).toBeGreaterThan(agentIdx);
    expect(summaryIdx).toBeGreaterThan(gitIdx);
  });

  it("omits the git block when none is provided", () => {
    const result = composeAgentRunPrompt({
      agent: makeAgent(),
      gitContextBlock: null,
      interpolation,
    });

    expect(result).toContain("You are a reviewer.");
    expect(result).not.toContain("# Git Context");
    expect(result.startsWith("You are a reviewer.")).toBe(true);
  });

  it("always appends the summary instruction", () => {
    const withGit = composeAgentRunPrompt({
      agent: makeAgent(),
      gitContextBlock: "# Git Context",
      interpolation,
    });
    const withoutGit = composeAgentRunPrompt({
      agent: makeAgent(),
      gitContextBlock: null,
      interpolation,
    });

    expect(withGit.endsWith(SUMMARY_INSTRUCTION)).toBe(true);
    expect(withoutGit.endsWith(SUMMARY_INSTRUCTION)).toBe(true);
  });

  it("interpolates template variables in the agent prompt", () => {
    const result = composeAgentRunPrompt({
      agent: makeAgent({ systemPrompt: "Project={PROJECT}\nDir={DIR}\nBranch={DEFAULT_BRANCH}" }),
      gitContextBlock: null,
      interpolation,
    });

    expect(result).toContain("Project=My App");
    expect(result).toContain("Dir=/ws");
    expect(result).toContain("Branch=main");
    expect(result).not.toContain("{PROJECT}");
    expect(result).not.toContain("{DIR}");
    expect(result).not.toContain("{DEFAULT_BRANCH}");
  });
});
