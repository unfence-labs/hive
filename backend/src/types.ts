import type { AgentActivity } from "@hive/shared/agent-activity";
export type { AgentActivity, AgentActivityCommandAction, AgentActivityFile } from "@hive/shared/agent-activity";

export type WorkspaceStatus = "idle" | "busy";

/** Kind of a persisted agent conversation session. */
export type SessionKind = "chat" | "automation" | "brain" | "terminal";

export interface Workspace {
  id: string;
  name: string;
  projectId: string;
  branch: string;
  status: WorkspaceStatus;
  createdAt: string;
  activeSessionId?: string;
  lastActivityAt?: string;
  /** Present when the workspace was created from a branch, PR, or issue. */
  source?: WorkspaceSource;
  /** Prompt pre-filled into the composer of a workspace created from an issue. */
  draftPrompt?: string;
}

export type WorkspaceSourceKind = "branch" | "pr" | "issue";

export interface WorkspaceSource {
  kind: WorkspaceSourceKind;
  /** Git branch the workspace was created on ("branch" and "pr" kinds). */
  branch?: string;
  /** PR or issue number ("pr" and "issue" kinds). */
  number?: number;
  /** Base branch of the PR ("pr" kind). */
  baseBranch?: string;
  title?: string;
  url?: string;
}

/** Body of `POST /api/projects/:id/workspaces`. */
export type CreateWorkspaceSourceInput =
  | { kind: "branch"; branch: string }
  | { kind: "pr"; number: number }
  | { kind: "issue"; number: number };

// ── Completion / autocomplete types ─────────────────────────────────

export type CompletionItemType = "slash_command" | "agent";
export type CompletionSource =
  | "builtin"
  | "user_command"
  | "project_command"
  | "user_skill"
  | "project_skill"
  | "admin_skill"
  | "plugin"
  | "user_agent"
  | "project_agent";

export interface CompletionItem {
  type: CompletionItemType;
  name: string;
  label: string;
  /** Native text sent to the provider when Hive displays a different trigger. */
  replacementLabel?: string;
  description?: string;
  argumentHint?: string;
  source: CompletionSource;
}

// ── Branch / GitHub sync types ──────────────────────────────────────

export interface PullRequestInfo {
  number: number;
  url: string;
  state: "open" | "draft" | "merged" | "closed";
  mergeable: boolean | null;
  mergeableState: "clean" | "conflict" | "blocked" | "unstable" | "unknown";
  checksStatus: "pending" | "success" | "failure" | "cancelled";
  checksPassed: number | null;
  checksTotal: number | null;
  reviewStatus: "approved" | "changes_requested" | "review_required" | null;
}

export interface BranchInfo {
  name: string;
  lastSyncedAt: string;
}

export interface PrStatusResponse {
  pr: PullRequestInfo | null;
  error?: string;
}

// ── Workspace source listing types (new-workspace-from picker) ──────

export interface ProjectBranchItem {
  name: string;
  /** Set when the branch is already checked out in an existing workspace. */
  workspaceId?: string;
  workspaceName?: string;
}

export interface ProjectPullItem {
  number: number;
  title: string;
  branch: string;
  url: string;
  isDraft: boolean;
  author?: string;
  updatedAt?: string;
  /** Set when the PR head branch is already checked out in a workspace. */
  workspaceId?: string;
  workspaceName?: string;
}

export interface ProjectIssueItem {
  number: number;
  title: string;
  url: string;
  author?: string;
  updatedAt?: string;
}

export interface WorkspaceFileTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: WorkspaceFileTreeNode[];
}

export interface ProjectState {
  id: string;
  name: string;
  url?: string;
  createdAt: string;
  workspaces: Workspace[];
}

/** Singleton Brain state returned by `/api/brain` and persisted when connected. */
export type BrainState =
  | { exists: false }
  | {
      exists: true;
      repoUrl: string;
      createdAt: string;
      /** Last successful push timestamp for the Brain clone. */
      lastSyncedAt?: string;
      /** Absolute local clone path. Derived from the data dir on every read. */
      repoPath: string;
    };

/** Working-tree change status for a single Brain file, relative to HEAD. */
export type BrainFileStatusKind =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "untracked";

/** One pending change in the Brain working tree (what `save` would commit). */
export interface BrainFileStatus {
  path: string;
  status: BrainFileStatusKind;
  /** Original path for renamed entries. */
  renamedFrom?: string;
}

/** Response of `GET /api/brain/status`: the set of changes awaiting save plus
 *  the upstream tracking ref for the header. */
export interface BrainStatusResponse {
  files: BrainFileStatus[];
  count: number;
  /** Upstream tracking ref (e.g. "origin/main"), or null when none is set. */
  upstream: string | null;
  /** Last successful Brain push timestamp, when known. */
  lastSyncedAt?: string;
  /** Local commits not yet pushed to upstream, or null when no upstream exists. */
  unpushedCommitCount: number | null;
}

/** Response of `POST /api/brain/save`: outcome of commit + push. */
export interface BrainSaveResponse {
  committed: boolean;
  pushed: boolean;
  /** Present when this save completed a successful push. */
  lastSyncedAt?: string;
  error?: string;
}

/**
 * Response of diff endpoints: the rendered unified diff plus the number of
 * untracked files omitted from `diff` because of the render cap.
 *
 * Save/commit flows can still include those omitted untracked files, so a
 * non-zero `omittedFileCount` means the UI must warn that the preview is
 * incomplete instead of implying the selected file has no changes.
 */
export interface DiffResponse {
  diff: string;
  omittedFileCount: number;
}

/** Response of `GET /api/brain/file`: a single file's path and text content. */
export interface BrainFileContent {
  path: string;
  content: string;
  /**
   * `true` when `content` is a bounded prefix of a file larger than the read
   * cap. The full file is intact on disk; the UI renders truncated content
   * read-only so a save cannot overwrite the dropped tail.
   */
  truncated?: boolean;
}

export type {
  ProjectEnvConfig,
  ProjectEnvData,
  ProjectEnvVariable,
} from "@hive/shared/project-env";

export type CreateProjectRequest =
  | { mode?: "clone"; url: string }
  | { mode: "create"; name: string; visibility?: "public" | "private" };

// ── Image attachment type ────────────────────────────────────────────

export interface ImageAttachment {
  name: string;
  mediaType: string;
  dataUrl: string;
}

// ── File mention type ───────────────────────────────────────────────

export interface FileMention {
  displayName: string;   // e.g. "git.ts" or "api/index.ts" (disambiguated)
  relativePath: string;  // e.g. "src/utils/git.ts"
}

// ── Session / Chat types ────────────────────────────────────────────

export interface SessionMetadata {
  sessionId: string;
  /** Provider-native conversation/thread id used for resume across turns. */
  providerSessionId?: string;
  /** @deprecated Use providerSessionId. Kept for old persisted sessions. */
  claudeSessionId?: string;
  workspaceId: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  /** Provider ID locked on first message (e.g. "claude" or "codex"). */
  lockedProvider?: string;
  /** Options from the last user message accepted for execution. */
  lastRunOptions?: MessageOptions;
  /** Session kind. Absent means "chat" for back-compat with older sessions. */
  kind?: SessionKind;
}

export interface ToolCall {
  id: string;
  name: string;
  input: string;
  output?: string;
  parentToolUseId?: string;
}

export interface ReasoningSegment {
  id: string;
  headline?: string;
  body?: string;
}

/** Raw reasoning text of one provider block. Persisted alongside the parsed
 *  `reasoningSegments` on purpose (not a duplication to clean up): clients render
 *  segments, while the raw block is the lossless source kept so a future run can
 *  re-parse history and diff it against the stored segments to verify the parser.
 */
export interface ReasoningBlock {
  id: string;
  text: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  images?: ImageAttachment[];
  fileMentions?: FileMention[];
  toolCalls?: ToolCall[];
  agentActivities?: AgentActivity[];
  goalCommand?: boolean;
  reasoningSegments?: ReasoningSegment[];
  reasoningBlocks?: ReasoningBlock[];
  timestamp: string;
  cancelled?: boolean;
  /** Extra diagnostics for interrupted turns (stderr summary, exit code). */
  errorDetail?: string;
  durationMs?: number;
  /** Total input tokens sent to the model for this turn. */
  inputTokens?: number;
  /** Output tokens generated by the model for this turn. */
  outputTokens?: number;
  /** Tokens currently occupying the model context window. */
  contextUsedTokens?: number;
  /** Context window size reported by the provider for this turn. */
  contextWindowTokens?: number;
}

// ── Claude CLI NDJSON types (--print --output-format stream-json --verbose) ──

/** Content block within an assistant message */
export type ServerToolResultType =
  | "web_search_tool_result"
  | "web_fetch_tool_result"
  | "bash_code_execution_tool_result"
  | "text_editor_code_execution_tool_result";

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown; parentToolUseId?: string }
  | { type: "server_tool_use"; id: string; name: string; input: unknown }
  | { type: "mcp_tool_use"; id: string; name: string; server_name: string; input: unknown }
  | { type: ServerToolResultType; tool_use_id: string; content: unknown }
  | { type: "mcp_tool_result"; tool_use_id: string; is_error: boolean; content: unknown }
  | { type: "thinking"; thinking: string }
  | { type: "redacted_thinking"; data: string };

/** Tool result block within a user message */
export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

export type CliJsonLine =
  | {
      type: "assistant";
      /**
       * Set by the Claude CLI on every message: null at top level, or the id of
       * the parent Task/Agent tool_use for messages emitted inside a subagent
       * sidechain. The ground-truth source for tool nesting.
       */
      parent_tool_use_id?: string | null;
      message: {
        id: string;
        role: "assistant";
        content: ContentBlock[];
        model?: string;
        stop_reason?: string;
        usage?: {
          input_tokens: number;
          output_tokens: number;
          cache_creation_input_tokens?: number;
          cache_read_input_tokens?: number;
        };
      };
    }
  | {
      type: "user";
      /** See the assistant variant: parent Task/Agent tool_use id for sidechain messages. */
      parent_tool_use_id?: string | null;
      message: {
        role: "user";
        content: ToolResultBlock[];
      };
    }
  | {
      type: "result";
      session_id: string;
      cost_usd?: number;
      duration_ms?: number;
      /** Provider-specific terminal status for protocol-backed runners. */
      status?: string;
      /** Provider-specific terminal error detail for failed turns. */
      error?: string;
      /** Provider-specific native turn id for protocol-backed runners. */
      turn_id?: string;
      /** Provider-specific native thread id for protocol-backed runners. */
      thread_id?: string;
      /** Codex adapters may place usage here; Claude puts it on assistant events. */
      usage?: {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
        context_used_tokens?: number;
        context_window?: number;
      };
    }
  | {
      type: "system";
      message: string;
      level?: string;
    };

// ── Script types ─────────────────────────────────────────────────────

export type ScriptType = string;
export type ScriptState = "idle" | "running" | "done" | "error";

// ── Diff types ───────────────────────────────────────────────────────

export type DiffFileStatus = "added" | "modified" | "deleted" | "renamed";
export type DiffScope = "combined" | "committed" | "uncommitted";

export interface DiffFileStat {
  file: string;
  additions: number;
  deletions: number;
  status: DiffFileStatus;
  renamedFrom?: string;
}

export interface DiffStatResponse {
  committed: DiffFileStat[];
  uncommitted: DiffFileStat[];
}

// ── Interactive tool input types ─────────────────────────────────────

export type ToolInputResult =
  | { type: "answer"; answers: QuestionAnswer[]; questions?: QuestionInput[] }
  | { type: "approve" }
  | { type: "reject"; message?: string }
  | { type: "dismiss"; message?: string };

export interface QuestionAnswer {
  questionIndex: number;
  selectedOptions: number[];
  customText?: string;
}

export interface QuestionInput {
  question: string;
  options: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
}

// ── WebSocket protocol ──────────────────────────────────────────────

/** Per-message options that control agent CLI behavior. */
export interface MessageOptions {
  planMode?: boolean;
  /** Compound model ID: "provider:model", e.g. "claude:opus-4-7" or "codex:gpt-5.5" */
  model?: string;
  /** Reasoning effort level for providers that support it (Claude `--effort`, Codex `model_reasoning_effort`). */
  thinkingLevel?: ThinkingLevel;
  /** Claude fast mode: high-speed Opus configuration (lower latency, higher cost). Opus-only. */
  fastMode?: boolean;
}

export type ThinkingLevel = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

export type BrowserSessionState = "registered" | "active" | "closed" | "error";

export interface BrowserStatusPayload {
  sessionId: string;
  state: BrowserSessionState;
  streaming?: boolean;
  streamPath?: string;
  url?: string;
  title?: string;
  updatedAt: number;
  lastActiveAt?: number;
  error?: string;
}

/** Frontend -> Backend */
export type WsIncoming =
  | { type: "switch_session"; sessionId: string }
  | { type: "user_message"; content: string; images?: ImageAttachment[]; fileMentions?: FileMention[]; options?: MessageOptions; sessionId?: string }
  | { type: "stop"; sessionId?: string }
  | { type: "tool_input_response"; requestId: string; toolName: string; result: ToolInputResult; sessionId?: string };

/** Backend -> Frontend */
export type WsOutgoing =
  | { type: "text_delta"; sessionId: string; text: string }
  | {
      type: "thinking";
      sessionId: string;
      /** Reasoning block the segments belong to; clients merge by block. */
      blockId: string;
      segments: ReasoningSegment[];
    }
  | { type: "tool_use"; sessionId: string; id: string; name: string; input: string; parentToolUseId?: string }
  | { type: "tool_result"; sessionId: string; toolUseId: string; output: string }
  | { type: "agent_activity"; sessionId: string; activity: AgentActivity }
  | {
      type: "stream_snapshot";
      sessionId: string;
      text: string;
      reasoningSegments: ReasoningSegment[];
      toolCalls: ToolCall[];
      agentActivities: AgentActivity[];
      agentPlanMode: boolean;
      streamingStartedAt?: number;
    }
  | { type: "tool_input_required"; sessionId: string; requestId: string; toolName: string; toolUseId: string; input: unknown }
  | { type: "tool_input_resolved"; sessionId: string }
  | {
      type: "done";
      sessionId: string;
      durationMs?: number;
      inputTokens?: number;
      outputTokens?: number;
      contextUsedTokens?: number;
      contextWindowTokens?: number;
      pendingToolName?: string;
    }
  | { type: "error"; message: string; sessionId?: string }
  | { type: "cancelled"; sessionId: string; errorDetail?: string; userInitiated?: boolean; durationMs?: number }
  | { type: "status"; status: WorkspaceStatus; sessionId?: string; streaming?: boolean; streamingStartedAt?: number; lockedProvider?: string }
  | { type: "user_message"; message: ChatMessage }
  | { type: "history"; messages: ChatMessage[]; sessionId?: string }
  | { type: "branch_info"; info: BranchInfo }
  | { type: "diff_stats"; stats: DiffStatResponse }
  | { type: "pr_status"; status: PrStatusResponse }
  | { type: "script_status"; scriptType: ScriptType; state: ScriptState; exitCode?: number }
  | { type: "browser_status"; status: BrowserStatusPayload }
  | { type: "plan_mode_changed"; sessionId: string; active: boolean };

// ── Automation types ─────────────────────────────────────────────────

export type AutomationTriggerType = "cron";
export type AutomationActionType = "agent";
export type AutomationRunStatus = "running" | "success" | "failure";

export interface AutomationTrigger {
  type: AutomationTriggerType;
  expression: string;
}

export interface AutomationAction {
  type: AutomationActionType;
  agentId: string;
  userPromptId?: string;
  userPromptInline?: string;
}

export interface AutomationNotification {
  onComplete: boolean;
  onFailure: boolean;
}

export interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  projectId?: string;
  trigger: AutomationTrigger;
  action: AutomationAction;
  notification: AutomationNotification;
  workspacePath?: string;
  lastRunId?: string;
  lastRunAt?: string;
  lastRunStatus?: AutomationRunStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  status: AutomationRunStatus;
  sessionId: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  summary?: string;
  error?: string;
}

export interface PromptTemplate {
  id: string;
  name: string;
  type: "user";
  content: string;
  createdAt: string;
  updatedAt: string;
}

// ── Agent entity ─────────────────────────────────────────────────────

export interface Agent {
  id: string;
  name: string;
  description?: string;
  systemPrompt: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
  readOnly: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentRequest {
  name: string;
  description?: string;
  systemPrompt: string;
  modelId: string;
  thinkingLevel?: ThinkingLevel;
  readOnly: boolean;
}

export interface UpdateAgentRequest {
  name?: string;
  description?: string;
  systemPrompt?: string;
  modelId?: string;
  thinkingLevel?: ThinkingLevel;
  readOnly?: boolean;
}

export interface CreateAutomationRequest {
  name: string;
  projectId?: string;
  trigger: AutomationTrigger;
  action: AutomationAction;
  notification?: AutomationNotification;
}

export interface UpdateAutomationRequest {
  name?: string;
  enabled?: boolean;
  trigger?: AutomationTrigger;
  action?: AutomationAction;
  notification?: AutomationNotification;
}

export interface CreatePromptTemplateRequest {
  name: string;
  type: "user";
  content: string;
}

export interface UpdatePromptTemplateRequest {
  name?: string;
  content?: string;
}

// ── Global skills settings ──────────────────────────────────────────

export type SkillProviderId = "claude" | "codex";
export type SkillSyncStatus =
  | "linked"
  | "synced"
  | "claude_only"
  | "codex_only"
  | "diverged"
  | "invalid";

export interface SkillProviderState {
  present: boolean;
  path: string;
  folderName?: string;
  isSymlink?: boolean;
  realPath?: string;
  hash?: string;
  updatedAt?: string;
  error?: string;
}

export interface SkillSummary {
  id: string;
  name: string;
  folderName: string;
  description?: string;
  argumentHint?: string;
  userInvocable: boolean;
  syncStatus: SkillSyncStatus;
  providers: Record<SkillProviderId, SkillProviderState>;
  invalidReason?: string;
  updatedAt?: string;
}

export interface SkillDetail extends SkillSummary {
  content: string;
  contentProvider: SkillProviderId;
  providerContents: Partial<Record<SkillProviderId, string>>;
}

export interface SkillListResponse {
  skills: SkillSummary[];
}

export interface CreateSkillRequest {
  content: string;
}

export interface UpdateSkillRequest {
  content: string;
}

export interface SkillSyncResponse {
  skills: SkillSummary[];
  syncedCount: number;
}

// ── Global instructions settings ────────────────────────────────────

export type InstructionProviderId = "claude" | "codex";
export type InstructionSyncStatus =
  | "missing"
  | "linked"
  | "synced"
  | "claude_only"
  | "codex_only"
  | "diverged"
  | "invalid";

export interface InstructionProviderState {
  present: boolean;
  path: string;
  isSymlink?: boolean;
  realPath?: string;
  hash?: string;
  updatedAt?: string;
  error?: string;
}

export interface InstructionOverrideState {
  present: boolean;
  active: boolean;
  path: string;
  hash?: string;
  size?: number;
  updatedAt?: string;
  error?: string;
}

export interface InstructionDetail {
  content: string;
  contentProvider: InstructionProviderId | null;
  syncStatus: InstructionSyncStatus;
  providers: Record<InstructionProviderId, InstructionProviderState>;
  providerContents: Partial<Record<InstructionProviderId, string>>;
  invalidReason?: string;
  updatedAt?: string;
  override: InstructionOverrideState;
}

export interface UpdateInstructionsRequest {
  content: string;
}

// ── Global custom agent settings ────────────────────────────────────

export type CustomAgentProviderId = "claude" | "codex";
export type CustomAgentStatus =
  | "both"
  | "claude_only"
  | "codex_only"
  | "invalid";

export interface CustomAgentProviderState {
  present: boolean;
  path: string;
  fileName?: string;
  isSymlink?: boolean;
  realPath?: string;
  hash?: string;
  updatedAt?: string;
  error?: string;
}

export interface CustomAgentSummary {
  id: string;
  name: string;
  description?: string;
  status: CustomAgentStatus;
  providers: Record<CustomAgentProviderId, CustomAgentProviderState>;
  invalidReason?: string;
  updatedAt?: string;
}

export interface CustomAgentDetail extends CustomAgentSummary {
  contents: Partial<Record<CustomAgentProviderId, string>>;
  manifests: Partial<Record<CustomAgentProviderId, {
    name: string;
    description?: string;
    developerInstructions?: string;
  }>>;
}

export interface CustomAgentListResponse {
  agents: CustomAgentSummary[];
}

export interface CreateCustomAgentRequest {
  provider: CustomAgentProviderId;
  content: string;
}

export interface UpdateCustomAgentRequest {
  content: string;
}

// ── Hub WebSocket protocol (multiplexed) ────────────────────────────

/** Client -> Server (hub-level). */
export type HubIncoming =
  // Finalized conversation history is REST-owned for all clients (React Query on
  // web, per-session cache on iOS), so the server never sends the `history`
  // bootstrap event; the hub bootstrap ships `status` and live stream snapshots
  // only. `focusWorkspaces` restricts high-frequency stream events to the
  // workspaces the client is actively viewing. `forceBootstrap` asks the server
  // to resend full bootstrap for already subscribed workspaces without a
  // reconnect (e.g. iOS foreground refresh on a healthy socket).
  | {
      type: "sync_workspaces";
      workspaceIds: string[];
      focusWorkspaces?: string[];
      prWorkspaces?: string[];
      forceBootstrap?: boolean;
    }
  // Application-level liveness probe. The browser WebSocket API never exposes
  // protocol-level ping/pong to JS, so clients send this to actively detect a
  // frozen-but-OPEN socket (e.g. after the OS wakes from sleep).
  | { type: "ping" }
  | { workspaceId: string; event: WsIncoming };

/** Server -> Client (hub-level). Workspace events are tagged with their workspace. */
export type HubOutgoing =
  | { workspaceId: string; event: WsOutgoing }
  /** Reply to a client `ping` (liveness probe). */
  | { type: "pong" };
