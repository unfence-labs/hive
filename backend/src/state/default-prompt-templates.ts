import { loadPromptTemplates, savePromptTemplate } from "./prompt-templates.js";
import type { PromptTemplate } from "../types.js";

const PR_REVIEW_ID = "builtin-pr-review";
const SECURITY_REVIEW_ID = "builtin-security-review";
const FULL_REVIEW_ID = "builtin-full-review";

const PR_REVIEW_TEMPLATE: PromptTemplate = {
  id: PR_REVIEW_ID,
  name: "PR Review",
  type: "user",
  content: `You are an expert code reviewer. Review this pull request thoroughly.

## PR Context

**PR #{PR_NUMBER}**: {PR_TITLE}
**Author**: {PR_AUTHOR}
**URL**: {PR_URL}

### Description
{PR_DESCRIPTION}

### Files changed
{PR_FILES}

### Diff
\`\`\`diff
{PR_DIFF}
\`\`\`

## Previous review context
{PREVIOUS_REVIEW}

## Instructions

Analyze the changes and provide a thorough code review that includes:

1. **Overview**: What does this PR do? Is the approach sound?
2. **Correctness**: Are there logic errors, off-by-one mistakes, missing null checks, or broken edge cases?
3. **Security**: Does this introduce injection risks, auth bypasses, or data leaks?
4. **Performance**: Are there N+1 queries, unnecessary allocations, or missing indexes?
5. **Conventions**: Does the code follow the project's existing patterns and style?
6. **Test coverage**: Are the changes adequately tested? What cases are missing?

For each issue found, specify:
- The file and approximate location
- Severity: **Bug** (must fix), **Nit** (should fix), or **Note** (consider)
- A concrete suggestion for how to fix it

Focus on correctness over style. Do not flag formatting issues covered by linters. If the PR looks good, say so briefly rather than inventing issues.`,
  createdAt: "2026-03-19T00:00:00.000Z",
  updatedAt: "2026-03-19T00:00:00.000Z",
};

const SECURITY_REVIEW_TEMPLATE: PromptTemplate = {
  id: SECURITY_REVIEW_ID,
  name: "Security Review",
  type: "user",
  content: `You are a senior security engineer conducting a focused security review of this pull request.

## PR Context

**PR #{PR_NUMBER}**: {PR_TITLE}
**Author**: {PR_AUTHOR}
**URL**: {PR_URL}

### Files changed
{PR_FILES}

### Diff
\`\`\`diff
{PR_DIFF}
\`\`\`

## Previous review context
{PREVIOUS_REVIEW}

## Objective

Identify HIGH-CONFIDENCE security vulnerabilities with real exploitation potential. This is NOT a general code review — focus ONLY on security implications newly introduced by this PR.

## Critical Instructions

1. **Minimize false positives**: Only flag issues where you are >80% confident of actual exploitability
2. **Avoid noise**: Skip theoretical issues, style concerns, or low-impact findings
3. **Focus on impact**: Prioritize vulnerabilities leading to unauthorized access, data breaches, or system compromise

## Security Categories to Examine

**Input Validation**: SQL injection, command injection, path traversal, template injection, XXE, NoSQL injection
**Authentication & Authorization**: Auth bypass, privilege escalation, session management flaws, JWT vulnerabilities
**Crypto & Secrets**: Hardcoded credentials, weak algorithms, improper key storage
**Injection & Code Execution**: RCE via deserialization, eval injection, XSS (reflected, stored, DOM-based)
**Data Exposure**: Sensitive data logging, PII handling violations, API data leakage

## Hard Exclusions — Do NOT report

- Denial of Service or resource exhaustion
- Secrets stored on disk if otherwise secured
- Rate limiting concerns
- Race conditions that are theoretical rather than practical
- Outdated third-party library vulnerabilities
- Memory safety issues in memory-safe languages
- Files that are only tests
- Log spoofing or logging unsanitized input (unless PII)
- SSRF that only controls the path (not host/protocol)
- XSS in React/Angular unless using dangerouslySetInnerHTML or similar
- Lack of client-side permission checks (server handles this)
- Regex injection or regex DoS
- Findings in documentation files

## Precedents

- Environment variables and CLI flags are trusted values
- UUIDs are assumed unguessable
- Logging URLs is safe; logging secrets/PII is not
- Subtle web vulns (tabnabbing, XS-Leaks, open redirects) should not be reported unless extremely high confidence

## Output Format

For each finding, report:

### Vuln N: [Category]: \`file:line\`

* **Severity**: High | Medium
* **Confidence**: 8-10 / 10
* **Description**: What the vulnerability is
* **Exploit Scenario**: How an attacker would exploit it
* **Recommendation**: How to fix it

## Severity Guidelines

- **HIGH**: Directly exploitable — RCE, data breach, auth bypass
- **MEDIUM**: Requires specific conditions but significant impact

Only include MEDIUM findings if they are obvious and concrete. Better to miss theoretical issues than flood the report with false positives.

If no security issues are found, state that clearly.`,
  createdAt: "2026-03-19T00:00:00.000Z",
  updatedAt: "2026-03-19T00:00:00.000Z",
};

const FULL_REVIEW_TEMPLATE: PromptTemplate = {
  id: FULL_REVIEW_ID,
  name: "Full Review (Code + Security)",
  type: "user",
  content: `You are a senior engineer performing a comprehensive code review and security audit of this pull request. You must cover BOTH aspects in a single structured report.

## PR Context

**PR #{PR_NUMBER}**: {PR_TITLE}
**Author**: {PR_AUTHOR}
**URL**: {PR_URL}

### Description
{PR_DESCRIPTION}

### Files changed
{PR_FILES}

### Diff
\`\`\`diff
{PR_DIFF}
\`\`\`

## Previous review context
{PREVIOUS_REVIEW}

---

# Part 1 — Code Review

Analyze the changes for:

1. **Correctness**: Logic errors, off-by-one mistakes, missing null checks, broken edge cases, race conditions
2. **Performance**: N+1 queries, unnecessary allocations, missing indexes, hot-path inefficiencies
3. **Conventions**: Does the code follow the project's existing patterns and style?
4. **Test coverage**: Are the changes adequately tested? What cases are missing?
5. **Design**: Is the approach sound? Are there simpler alternatives?

For each issue, report:
- File and location
- Severity: **Bug** (must fix before merge), **Nit** (should fix but not blocking), or **Note** (worth considering)
- A concrete fix suggestion

Do not flag formatting issues covered by linters. If everything looks good, say so.

---

# Part 2 — Security Audit

Focus ONLY on security vulnerabilities newly introduced by this PR. Minimize false positives — only flag issues with >80% confidence of real exploitability.

## Categories to Examine

- **Input Validation**: SQL/command/path/template injection, XXE, NoSQL injection
- **Auth & Authorization**: Auth bypass, privilege escalation, session flaws, JWT issues
- **Crypto & Secrets**: Hardcoded credentials, weak algorithms, improper key storage
- **Injection & RCE**: Deserialization, eval injection, XSS (only if using unsafe methods like dangerouslySetInnerHTML)
- **Data Exposure**: Sensitive data logging, PII violations, API data leakage

## Do NOT report

- DoS / resource exhaustion
- Race conditions that are theoretical
- Outdated third-party library vulns
- Memory safety in memory-safe languages
- Test-only files
- SSRF controlling only the path
- XSS in React/Angular without unsafe methods
- Client-side permission checks (server handles it)
- Regex injection/DoS
- Findings in documentation files
- Log spoofing (unless PII)

## Precedents

- Env vars and CLI flags are trusted
- UUIDs are unguessable
- Logging URLs is safe; logging secrets/PII is not

For each vulnerability, report:

### Vuln N: [Category]: \`file:line\`
* **Severity**: High | Medium
* **Confidence**: 8-10 / 10
* **Description**: What the vulnerability is
* **Exploit Scenario**: How an attacker would exploit it
* **Recommendation**: How to fix it

If no security issues are found, state that clearly.

---

# Output Structure

Use this exact structure for your response:

## Summary
One paragraph: what this PR does, overall quality assessment, and whether it's safe to merge.

## Code Review Findings
List all code quality findings (or "No issues found").

## Security Findings
List all security findings (or "No security issues found").

## Verdict
**APPROVE**, **REQUEST CHANGES**, or **NEEDS DISCUSSION** — with a one-line justification.`,
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
