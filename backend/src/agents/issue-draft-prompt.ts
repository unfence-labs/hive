import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const DEFAULT_ISSUE_DRAFT_PROMPT = `Work on issue #{NUMBER}: {TITLE}
{URL}

{BODY}`;

export interface IssueDraftPromptValues {
  number: number;
  title: string;
  url: string;
  body: string;
}

/**
 * Load the issue draft prompt template from `{promptsDir}/issue-draft.md`.
 * Returns the hardcoded default if the file can't be read.
 */
export async function loadIssueDraftPrompt(promptsDir: string): Promise<string> {
  try {
    return await readFile(join(promptsDir, "issue-draft.md"), "utf-8");
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("[issue-draft-prompt] Failed to load issue-draft.md, using default:", err);
    }
    return DEFAULT_ISSUE_DRAFT_PROMPT;
  }
}

/**
 * Replace issue placeholders with concrete values. The result is trimmed so an
 * empty {BODY} doesn't leave trailing blank lines.
 */
export function interpolateIssueDraftPrompt(
  template: string,
  values: IssueDraftPromptValues,
): string {
  return template
    .replace(/\{NUMBER}/g, String(values.number))
    .replace(/\{TITLE}/g, values.title)
    .replace(/\{URL}/g, values.url)
    .replace(/\{BODY}/g, values.body)
    .trim();
}
