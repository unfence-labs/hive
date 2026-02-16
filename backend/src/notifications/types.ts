// ── Notification events ─────────────────────────────────────────────
// Discriminated union: each event carries exactly the data it needs.
// To add a new trigger, add a variant here and call notifier.notify() at the source.

export type NotificationEvent = {
  type: "agent_turn_complete";
  workspaceId: string;
  workspaceName: string;
  projectName: string;
  sessionId: string;
  durationMs?: number;
};

// ── Channel interface ───────────────────────────────────────────────
// Implement this to add a new delivery channel (Slack, email, etc.).

export interface NotificationChannel {
  readonly name: string;
  isEnabled(): boolean;
  send(event: NotificationEvent): Promise<void>;
}
