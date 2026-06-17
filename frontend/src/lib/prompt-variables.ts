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
