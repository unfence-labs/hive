/**
 * Template variables the backend interpolates into agent/base prompts
 * (`interpolatePromptVariables`). Mirrored here to drive editor hints; keep in
 * sync with the backend interpolation values.
 */
export const TEMPLATE_VARIABLES = [
  { token: "{DIR}", desc: "workspace path" },
  { token: "{DEFAULT_BRANCH}", desc: "target branch" },
  { token: "{PROJECT}", desc: "project name" },
] as const;

/**
 * Variables interpolated into the issue draft prompt when a workspace is
 * created from a GitHub issue. Keep in sync with the backend interpolation.
 */
export const ISSUE_DRAFT_VARIABLES = [
  { token: "{NUMBER}", desc: "issue number" },
  { token: "{TITLE}", desc: "issue title" },
  { token: "{URL}", desc: "issue URL" },
  { token: "{BODY}", desc: "issue description" },
] as const;
