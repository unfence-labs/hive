const SHORT_LABELS: Record<string, string> = {
  "pull_request.opened": "PR open",
  "pull_request.synchronize": "PR update",
  "pull_request.reopened": "PR reopen",
  "pull_request.comment": "PR comment",
  "issues.opened": "Issue open",
  "issues.comment": "Issue comment",
};

export function describeGitHubEvents(events: string[]): string {
  const labels = events.map(e => SHORT_LABELS[e] ?? e);
  if (labels.length <= 2) return labels.join(", ");
  return `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`;
}
