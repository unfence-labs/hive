import type { AgentActivity } from "@hive/shared/agent-activity";
export type { AgentActivity, AgentActivityFile } from "@hive/shared/agent-activity";

export interface Project {
  id: string;
  name: string;
  url?: string;
  createdAt: string;
  workspaces: Workspace[];
  repoPath?: string;
  workspacesPath?: string;
  hasFavicon?: boolean;
  faviconVersion?: string;
  /** Present when GitHub repo creation failed (project degraded to local-only). */
  warning?: string;
}

/** Singleton Brain state returned by `/api/brain`. */
export type BrainState =
  | { exists: false }
  | {
      exists: true;
      repoUrl: string;
      createdAt: string;
      /** Last successful push timestamp for the Brain clone. */
      lastSyncedAt?: string;
      /** Absolute local clone path on the backend host (for the copy-path action). */
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

export interface Workspace {
  id: string;
  name: string;
  branch: string;
  status: "idle" | "busy";
  createdAt: string;
  lastActivityAt?: string;
  activeSessionId?: string;
  projectName?: string;
  defaultBranch?: string;
  worktreePath?: string;
  /** Present when the workspace was created from a branch, PR, or issue. */
  source?: WorkspaceSource;
  /** Prompt pre-filled into the composer of a freshly created workspace. */
  draftPrompt?: string;
}

export interface WorkspaceSource {
  kind: "branch" | "pr" | "issue";
  branch?: string;
  number?: number;
  title?: string;
  url?: string;
}

/** Body of `POST /api/projects/:id/workspaces`. */
export type CreateWorkspaceSource =
  | { kind: "branch"; branch: string }
  | { kind: "pr"; number: number }
  | { kind: "issue"; number: number };

// ── Workspace source listing types (new-workspace-from picker) ──────

export interface ProjectBranchItem {
  name: string;
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

// ── Tab types ───────────────────────────────────────────────────────

export type Tab =
  | { type: "session"; sessionId: string }
  | { type: "file"; path: string };

export type TabId = `session:${string}` | `file:${string}`;

export function tabId(tab: Tab): TabId {
  return tab.type === "session" ? `session:${tab.sessionId}` : `file:${tab.path}`;
}

export function parseTabId(id: TabId): Tab {
  if (id.startsWith("session:")) return { type: "session", sessionId: id.slice(8) };
  return { type: "file", path: id.slice(5) };
}

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

export interface WorkspaceFileTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: WorkspaceFileTreeNode[];
}

// ── Queued message type ──────────────────────────────────────────────

export interface QueuedMessage {
  content: string;
  images?: ImageAttachment[];
  options?: MessageOptions;
  fileMentions?: FileMention[];
}

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

/** Discriminates the surface a session drives. Absent = "chat". Keep in sync
 *  with the backend `SessionKind`. */
export type SessionKind = "chat" | "automation" | "brain" | "terminal";

export interface SessionMetadata {
  sessionId: string;
  /** Provider-native conversation/thread id used for resume across turns. */
  providerSessionId?: string;
  /** @deprecated Use providerSessionId. Kept for old persisted sessions. */
  claudeSessionId?: string;
  workspaceId: string;
  title?: string;
  /** Session surface; absent means a regular chat session. */
  kind?: SessionKind;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lockedProvider?: string;
  /** Options from the last user message accepted for execution. */
  lastRunOptions?: MessageOptions;
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

/** Raw reasoning text of one provider block, persisted as the lossless source
 *  the parsed `reasoningSegments` derive from (clients render segments only). */
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

// ── Question / Plan types (for AskUserQuestion & ExitPlanMode tools) ─

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface Question {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: QuestionOption[];
}

export interface QuestionAnswer {
  questionIndex: number;
  selectedOptions: number[];
  customText?: string;
}

export function isAskUserQuestion(tool: ToolCall): boolean {
  try {
    const input = JSON.parse(tool.input);
    return tool.name === "AskUserQuestion" && Array.isArray(input?.questions);
  } catch { return false; }
}

export function isExitPlanMode(tool: ToolCall): boolean {
  return tool.name === "ExitPlanMode";
}

export function parseQuestions(tool: ToolCall): Question[] {
  try {
    return JSON.parse(tool.input).questions ?? [];
  } catch { return []; }
}

// ── Script types ─────────────────────────────────────────────────────

export type ScriptType = string;
export type ScriptState = "idle" | "running" | "done" | "error";

export interface HiveConfig {
  scripts?: { setup?: string; run?: Record<string, string> };
  port?: number;
}

export interface ScriptStatusInfo {
  state: ScriptState;
  exitCode?: number;
}

export interface WorkspaceScriptsResponse {
  config: HiveConfig | null;
  status: Record<string, ScriptStatusInfo>;
}

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

export interface QuestionInput {
  question: string;
  options: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
}

// ── Per-message options ──────────────────────────────────────────────

export type ThinkingLevel = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

/** Per-message options that control agent CLI behavior. */
export interface MessageOptions {
  planMode?: boolean;
  /** Compound model ID: "provider:model", e.g. "claude:opus-4-7" */
  model?: string;
  /** Reasoning effort level for providers that support it (Claude `--effort`, Codex `model_reasoning_effort`). */
  thinkingLevel?: ThinkingLevel;
  /** Claude fast mode: high-speed Opus configuration (lower latency, higher cost). Opus-only. */
  fastMode?: boolean;
}

// ── Model catalog types ─────────────────────────────────────────────

export interface ProviderCapabilities {
  /** Reasoning-effort levels this provider supports. Empty array means no control. */
  thinkingLevels: ThinkingLevel[];
  planMode: boolean;
  blockingTools: boolean;
  completions: boolean;
  goals: boolean;
}

export interface ModelCatalogEntry {
  id: string;
  label: string;
  provider: string;
  providerLabel: string;
  isDefault?: boolean;
  capabilities: ProviderCapabilities;
  /** Maximum context window size in tokens. */
  contextWindow?: number;
  /** Whether this model supports Claude fast mode (Opus-only). */
  supportsFastMode?: boolean;
}

export interface ModelCatalogResponse {
  models: ModelCatalogEntry[];
  defaultModelId: string;
}

// ── WebSocket protocol ──────────────────────────────────────────────

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
  | { type: "status"; status: "idle" | "busy"; sessionId?: string; streaming?: boolean; streamingStartedAt?: number; lockedProvider?: string }
  | { type: "user_message"; message: ChatMessage }
  | { type: "history"; messages: ChatMessage[]; sessionId?: string }
  | { type: "branch_info"; info: BranchInfo }
  | { type: "diff_stats"; stats: DiffStatResponse }
  | { type: "pr_status"; status: PrStatusResponse }
  | { type: "script_status"; scriptType: ScriptType; state: ScriptState; exitCode?: number }
  | { type: "browser_status"; status: BrowserStatusPayload }
  | { type: "plan_mode_changed"; sessionId: string; active: boolean };

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

export interface BasePromptData {
  content: string;
  isDefault: boolean;
  defaultContent: string;
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

export interface CustomAgentManifest {
  name: string;
  description?: string;
  developerInstructions?: string;
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
  manifests: Partial<Record<CustomAgentProviderId, CustomAgentManifest>>;
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

/** Server -> Client (hub-level). Workspace events are tagged with their workspace. */
export type HubOutgoing =
  | { workspaceId: string; event: WsOutgoing }
  /** Reply to a client `ping` (liveness probe). */
  | { type: "pong" };
