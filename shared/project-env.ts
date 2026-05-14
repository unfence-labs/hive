export interface ProjectEnvVariable {
  id: string;
  key: string;
  value: string;
  comment?: string;
}

export interface ProjectEnvConfig {
  variables: ProjectEnvVariable[];
}

export interface ProjectEnvData {
  exists: boolean;
  config: ProjectEnvConfig;
  path?: string;
  sizeBytes?: number;
  updatedAt?: string;
}

export interface ProjectEnvValidationResult {
  valid: boolean;
  errors: string[];
}

export const EMPTY_PROJECT_ENV_CONFIG: ProjectEnvConfig = { variables: [] };

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function normalizeProjectEnvConfig(config: ProjectEnvConfig): ProjectEnvConfig {
  return {
    variables: config.variables.flatMap((variable): ProjectEnvVariable[] => {
      if (!variable.id) return [];
      return [{
        id: variable.id,
        key: variable.key.trim(),
        value: variable.value,
        comment: normalizeOptionalText(variable.comment),
      }];
    }),
  };
}

export function hasProjectEnvVariables(config: ProjectEnvConfig): boolean {
  return normalizeProjectEnvConfig(config).variables.length > 0;
}

export function countProjectEnvVariables(config: ProjectEnvConfig): number {
  return normalizeProjectEnvConfig(config).variables.length;
}

export function isValidProjectEnvKey(key: string): boolean {
  return ENV_KEY_PATTERN.test(key);
}

export function validateProjectEnvConfig(config: ProjectEnvConfig): ProjectEnvValidationResult {
  const errors: string[] = [];
  const keys = new Map<string, number>();

  for (const variable of normalizeProjectEnvConfig(config).variables) {
    if (!variable.key) {
      errors.push("Variable keys cannot be empty.");
      continue;
    }
    if (!isValidProjectEnvKey(variable.key)) {
      errors.push(`${variable.key} is not a valid environment variable key.`);
    }

    keys.set(variable.key, (keys.get(variable.key) ?? 0) + 1);
  }

  for (const [key, count] of keys) {
    if (count > 1) errors.push(`${key} is duplicated.`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function parseProjectEnvConfig(raw: unknown): ProjectEnvConfig | null {
  if (!isRecord(raw) || !Array.isArray(raw.variables)) return null;

  const variables: ProjectEnvVariable[] = [];
  for (const rawVariable of raw.variables) {
    if (!isRecord(rawVariable) || typeof rawVariable.id !== "string") return null;
    if (typeof rawVariable.key !== "string" || typeof rawVariable.value !== "string") return null;
    if (rawVariable.comment !== undefined && typeof rawVariable.comment !== "string") return null;

    variables.push({
      id: rawVariable.id,
      key: rawVariable.key,
      value: rawVariable.value,
      comment: rawVariable.comment,
    });
  }

  return normalizeProjectEnvConfig({ variables });
}

function commentLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => `# ${line.trim()}`.trimEnd());
}

export function generateProjectEnvContent(config: ProjectEnvConfig): string {
  const lines: string[] = [];

  for (const variable of normalizeProjectEnvConfig(config).variables) {
    if (variable.comment) {
      if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
      lines.push(...commentLines(variable.comment));
    }
    lines.push(`${variable.key}=${variable.value}`);
  }

  const content = lines.join("\n").trim();
  return content ? `${content}\n` : "";
}
