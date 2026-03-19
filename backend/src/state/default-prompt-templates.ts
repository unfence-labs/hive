import { loadPromptTemplates, savePromptTemplate } from "./prompt-templates.js";
import type { PromptTemplate } from "../types.js";

const PR_REVIEW_ID = "builtin-pr-review";
const SECURITY_REVIEW_ID = "builtin-security-review";
const FULL_REVIEW_ID = "builtin-full-review";

const PR_REVIEW_TEMPLATE: PromptTemplate = {
  id: PR_REVIEW_ID,
  name: "PR Review",
  type: "user",
  content: `You are reviewing PR #{PR_NUMBER} ({PR_TITLE}) by {PR_AUTHOR}.
URL: {PR_URL}

## PR Description
{PR_DESCRIPTION}

## Files changed
{PR_FILES}

## Diff
\`\`\`diff
{PR_DIFF}
\`\`\`

## Previous review context
{PREVIOUS_REVIEW}

---

# Your Task

Read every line of the diff. Find bugs, logic errors, and concrete improvements. Do NOT summarize what the PR does — the author knows. Do NOT flag style or formatting.

Every finding MUST include the exact file path, line reference, and a code snippet from the diff.

For each finding:

### {N}. [{BUG|NIT|NOTE}] {title} — \`{file}:{line}\`

\`\`\`{lang}
// the problematic code from the diff
\`\`\`

**Problem:** {what exactly goes wrong and when}
**Fix:** {concrete fix with code}

Severity: **Bug** = must fix before merge, **Nit** = should fix, **Note** = worth considering.

If the code is correct, say so briefly. Do not invent issues.`,
  createdAt: "2026-03-19T00:00:00.000Z",
  updatedAt: "2026-03-19T00:00:00.000Z",
};

const SECURITY_REVIEW_TEMPLATE: PromptTemplate = {
  id: SECURITY_REVIEW_ID,
  name: "Security Review",
  type: "user",
  content: `Security audit of PR #{PR_NUMBER} ({PR_TITLE}) by {PR_AUTHOR}.
URL: {PR_URL}

## Files changed
{PR_FILES}

## Diff
\`\`\`diff
{PR_DIFF}
\`\`\`

## Previous review context
{PREVIOUS_REVIEW}

---

# Your Task

Read every line of the diff. Find security vulnerabilities newly introduced by this PR. Only flag issues with >80% confidence of real exploitability. This is NOT a code review — focus ONLY on security.

**Look for:** injection (SQL, command, path, template), auth bypass, privilege escalation, hardcoded secrets, unsafe deserialization, XSS via dangerouslySetInnerHTML or similar, data exposure (PII logged, secrets leaked).

**Do NOT flag:** DoS, theoretical race conditions, outdated deps, test files, regex DoS, SSRF path-only, XSS in React without unsafe methods, missing client-side checks, log spoofing unless PII, documentation files. Env vars and CLI flags are trusted. UUIDs are unguessable.

Every finding MUST include the exact file path, line reference, and a code snippet from the diff.

For each finding:

### {N}. [{HIGH|MEDIUM}] {title} — \`{file}:{line}\`

\`\`\`{lang}
// the vulnerable code from the diff
\`\`\`

**Attack:** {step-by-step exploit scenario}
**Fix:** {concrete fix with code}

HIGH = directly exploitable (RCE, data breach, auth bypass). MEDIUM = requires specific conditions but significant impact.

If no security issues are found, state that clearly. Do not invent issues.`,
  createdAt: "2026-03-19T00:00:00.000Z",
  updatedAt: "2026-03-19T00:00:00.000Z",
};

const FULL_REVIEW_TEMPLATE: PromptTemplate = {
  id: FULL_REVIEW_ID,
  name: "Full Review (Code + Security)",
  type: "user",
  content: `You are a senior engineer reviewing PR #{PR_NUMBER} ({PR_TITLE}) by {PR_AUTHOR}.
URL: {PR_URL}

## PR Description
{PR_DESCRIPTION}

## Files changed
{PR_FILES}

## Diff
\`\`\`diff
{PR_DIFF}
\`\`\`

## Previous review context
{PREVIOUS_REVIEW}

---

# Your Task

Read every line of the diff above. Your job is to find concrete bugs, security vulnerabilities, and real improvements — NOT to summarize what the PR does.

**Rules:**
- DO NOT start with a summary of what the PR does. The author already knows.
- DO NOT invent issues. If the code is correct, say so.
- DO NOT flag style, formatting, naming, or anything a linter handles.
- Every finding MUST include the exact file path, line reference, and a code snippet from the diff.
- Be specific. "This could be a problem" is useless. Show the problematic code and explain exactly what breaks.

---

# 1. Security Issues

Search for vulnerabilities newly introduced by this diff. Only flag issues with >80% confidence of real exploitability.

**Look for:** injection (SQL, command, path, template), auth bypass, privilege escalation, hardcoded secrets, unsafe deserialization, XSS via dangerouslySetInnerHTML or similar, data exposure (PII logged, secrets leaked).

**Do NOT flag:** DoS, theoretical race conditions, outdated deps, test files, regex DoS, SSRF path-only, XSS in React without unsafe methods, missing client-side checks, log spoofing unless PII. Env vars and CLI flags are trusted. UUIDs are unguessable.

For each finding:

### S{N}. [{HIGH|MEDIUM}] {title} — \`{file}:{line}\`

\`\`\`{lang}
// the problematic code from the diff
\`\`\`

**Attack:** {how an attacker exploits this, step by step}
**Fix:** {concrete fix with code}

---

# 2. Bugs

Look for logic errors, off-by-one mistakes, null/undefined crashes, broken edge cases, race conditions, incorrect return values, missing error handling that causes silent failures.

For each finding:

### B{N}. [{BUG|NIT}] {title} — \`{file}:{line}\`

\`\`\`{lang}
// the problematic code from the diff
\`\`\`

**Problem:** {what exactly goes wrong and when}
**Fix:** {concrete fix with code}

---

# 3. Improvements

Simplifications, duplication that should be extracted, dead code, missing edge cases in tests, performance issues on hot paths (N+1, unbounded allocations).

For each finding:

### I{N}. {title} — \`{file}:{line}\`

\`\`\`{lang}
// the relevant code
\`\`\`

**Why:** {why this matters}
**Suggestion:** {what to change}

---

# 4. Verdict

Summarize in a table:

| # | Type | Severity | File | Title |
|---|------|----------|------|-------|

Then give exactly one verdict:

> **✅ APPROVE** — No blocking issues. [one-line justification]

> **❌ REQUEST CHANGES** — [list blocking issues by number]

> **🟡 NEEDS DISCUSSION** — [what needs human judgement]

APPROVE = zero Bug/High findings. REQUEST CHANGES = at least one Bug or High. NEEDS DISCUSSION = borderline.`,
  createdAt: "2026-03-19T00:00:00.000Z",
  updatedAt: "2026-03-19T00:00:00.000Z",
};

const DEFAULT_TEMPLATES = [PR_REVIEW_TEMPLATE, SECURITY_REVIEW_TEMPLATE, FULL_REVIEW_TEMPLATE];

/**
 * Seed built-in prompt templates if they don't already exist.
 * Called once at server startup. Existing templates with the same ID
 * are left untouched (user may have customized them).
 */
export async function seedDefaultTemplates(dataDir: string): Promise<void> {
  const existing = await loadPromptTemplates(dataDir);
  const existingIds = new Set(existing.map((t) => t.id));

  for (const tpl of DEFAULT_TEMPLATES) {
    if (!existingIds.has(tpl.id)) {
      await savePromptTemplate(tpl, dataDir);
      console.log(`[templates] Seeded default template: ${tpl.name}`);
    }
  }
}
