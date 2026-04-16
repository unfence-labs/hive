import Foundation

// MARK: - Model Catalog

struct ProviderCapabilities: Codable, Equatable {
    let thinking: Bool
    let planMode: Bool
    let blockingTools: Bool
    let completions: Bool
}

struct ModelCatalogEntry: Codable, Identifiable, Equatable {
    let id: String
    let label: String
    let provider: String
    let providerLabel: String
    let isDefault: Bool?
    let isNew: Bool?
    let capabilities: ProviderCapabilities
    let contextWindow: Int?
}

struct ModelCatalogResponse: Codable {
    let models: [ModelCatalogEntry]
    let defaultModelId: String
}

// MARK: - Enums

enum WorkspaceStatus: String, Codable {
    case idle
    case busy
}

enum MessageRole: String, Codable {
    case user
    case assistant
}

enum PRState: String, Codable {
    case open
    case draft
    case merged
    case closed
}

enum MergeableState: String, Codable {
    case clean
    case conflict
    case blocked
    case unstable
    case unknown
}

enum ChecksStatus: String, Codable {
    case pending
    case success
    case failure
    case cancelled
}

enum ReviewStatus: String, Codable {
    case approved
    case changes_requested
    case review_required
}

enum DiffFileStatus: String, Codable {
    case added
    case modified
    case deleted
    case renamed
}

// MARK: - Account Status

struct AccountStatusResponse: Codable {
    let ghInstalled: Bool
    let authenticated: Bool
    let user: AccountUser?
}

struct AccountUser: Codable {
    let login: String
    let name: String?
    let email: String?
    let avatarUrl: String?
}

// MARK: - Project & Workspace

struct Project: Codable, Identifiable {
    let id: String
    let name: String
    let url: String?
    let createdAt: String
    var workspaces: [Workspace]
    var hasFavicon: Bool? = nil
}

struct Workspace: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let branch: String
    let status: WorkspaceStatus
    let createdAt: String
    let activeSessionId: String?
    let projectName: String?
    let defaultBranch: String?
    var sessionCount: Int? = nil
    var projectId: String? = nil
    var hasFavicon: Bool? = nil
}

// MARK: - Branch & PR

struct PullRequestInfo: Codable {
    let number: Int
    let url: String
    let state: PRState
    let mergeable: Bool?
    let mergeableState: MergeableState
    let checksStatus: ChecksStatus
    let checksPassed: Int?
    let checksTotal: Int?
    let reviewStatus: ReviewStatus?
}

struct BranchInfo: Codable {
    let name: String
    let lastSyncedAt: String
}

struct PrStatusResponse: Codable {
    let pr: PullRequestInfo?
    let error: String?
}

struct BulkPrStatusResponse: Codable {
    let results: [String: PrStatusResponse]
}

// MARK: - Session & Chat

struct SessionMetadata: Codable, Identifiable {
    let sessionId: String
    let claudeSessionId: String?
    let workspaceId: String
    let title: String?
    let createdAt: String
    let updatedAt: String
    let messageCount: Int
    let lockedProvider: String?

    var id: String { sessionId }
}

struct ImageAttachment: Codable, Equatable {
    let name: String
    let mediaType: String
    let dataUrl: String
}

struct FileMention: Codable, Equatable {
    let displayName: String
    let relativePath: String
}

struct ToolCall: Codable, Identifiable {
    let id: String
    let name: String
    let input: String
    let output: String?
    let parentToolUseId: String?

    init(id: String, name: String, input: String, output: String?, parentToolUseId: String?) {
        self.id = id
        self.name = name
        self.input = input
        self.output = output
        self.parentToolUseId = parentToolUseId
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        input = try container.decode(String.self, forKey: .input)
        parentToolUseId = try container.decodeIfPresent(String.self, forKey: .parentToolUseId)
        // output can be a string or (rarely) a JSON array/object from the CLI — coerce to string
        if let str = try? container.decodeIfPresent(String.self, forKey: .output) {
            output = str
        } else if let raw = try? container.decodeIfPresent(AnyCodableValue.self, forKey: .output),
                  let data = try? JSONEncoder().encode(raw) {
            output = String(data: data, encoding: .utf8)
        } else {
            output = nil
        }
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, input, output, parentToolUseId
    }
}

struct ChatMessage: Codable, Identifiable {
    let id: String
    let sessionId: String
    let role: MessageRole
    let content: String
    let images: [ImageAttachment]?
    let fileMentions: [FileMention]?
    let toolCalls: [ToolCall]?
    let thinkingContent: String?
    let timestamp: String
    let cancelled: Bool?
    let durationMs: Int?
    let inputTokens: Int?
    let outputTokens: Int?

    init(id: String, sessionId: String, role: MessageRole, content: String,
         images: [ImageAttachment]?, fileMentions: [FileMention]? = nil,
         toolCalls: [ToolCall]?, thinkingContent: String?,
         timestamp: String, cancelled: Bool?, durationMs: Int?,
         inputTokens: Int? = nil, outputTokens: Int? = nil) {
        self.id = id
        self.sessionId = sessionId
        self.role = role
        self.content = content
        self.images = images
        self.fileMentions = fileMentions
        self.toolCalls = toolCalls
        self.thinkingContent = thinkingContent
        self.timestamp = timestamp
        self.cancelled = cancelled
        self.durationMs = durationMs
        self.inputTokens = inputTokens
        self.outputTokens = outputTokens
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        sessionId = try container.decode(String.self, forKey: .sessionId)
        role = try container.decode(MessageRole.self, forKey: .role)
        content = try container.decode(String.self, forKey: .content)
        images = try container.decodeIfPresent([ImageAttachment].self, forKey: .images)
        fileMentions = try container.decodeIfPresent([FileMention].self, forKey: .fileMentions)
        toolCalls = try container.decodeIfPresent([ToolCall].self, forKey: .toolCalls)
        thinkingContent = try container.decodeIfPresent(String.self, forKey: .thinkingContent)
        timestamp = try container.decode(String.self, forKey: .timestamp)
        cancelled = try container.decodeIfPresent(Bool.self, forKey: .cancelled)
        // durationMs may arrive as Int or Double from the backend
        if let intVal = try? container.decodeIfPresent(Int.self, forKey: .durationMs) {
            durationMs = intVal
        } else if let doubleVal = try? container.decodeIfPresent(Double.self, forKey: .durationMs) {
            durationMs = Int(doubleVal)
        } else {
            durationMs = nil
        }
        if let intVal = try? container.decodeIfPresent(Int.self, forKey: .inputTokens) {
            inputTokens = intVal
        } else if let doubleVal = try? container.decodeIfPresent(Double.self, forKey: .inputTokens) {
            inputTokens = Int(doubleVal)
        } else {
            inputTokens = nil
        }
        if let intVal = try? container.decodeIfPresent(Int.self, forKey: .outputTokens) {
            outputTokens = intVal
        } else if let doubleVal = try? container.decodeIfPresent(Double.self, forKey: .outputTokens) {
            outputTokens = Int(doubleVal)
        } else {
            outputTokens = nil
        }
    }

    private enum CodingKeys: String, CodingKey {
        case id, sessionId, role, content, images, fileMentions, toolCalls
        case thinkingContent, timestamp, cancelled, durationMs
        case inputTokens, outputTokens
    }
}

// MARK: - Diff

struct DiffFileStat: Codable, Identifiable {
    let file: String
    let additions: Int
    let deletions: Int
    let status: DiffFileStatus
    let renamedFrom: String?

    var id: String { file }
}

struct DiffStatResponse: Codable {
    let committed: [DiffFileStat]
    let uncommitted: [DiffFileStat]
}

// MARK: - Questions & Tool Input

struct QuestionOption: Codable {
    let label: String
    let description: String?
}

struct Question: Codable {
    let question: String
    let header: String?
    let multiSelect: Bool?
    let options: [QuestionOption]
}

struct QuestionAnswer: Codable {
    let questionIndex: Int
    let selectedOptions: [Int]
    let customText: String?
}

struct QuestionInput: Codable {
    let question: String
    let options: [QuestionOption]
    let multiSelect: Bool?
}

enum ThinkingLevel: String, Codable, CaseIterable {
    case low, medium, high, xhigh

    var label: String {
        switch self {
        case .low: "Low"
        case .medium: "Med"
        case .high: "High"
        case .xhigh: "xHigh"
        }
    }

    func next() -> ThinkingLevel {
        let all = Self.allCases
        let idx = all.firstIndex(of: self)!
        return all[(idx + 1) % all.count]
    }
}

struct MessageOptions: Codable {
    let planMode: Bool?
    let model: String?
    let thinkingLevel: ThinkingLevel?
}

// MARK: - Automation

enum AutomationRunStatus: String, Codable {
    case running
    case success
    case failure
}

struct AutomationTrigger: Codable {
    let type: String
    let expression: String
}

struct AutomationAction: Codable {
    let type: String
    let modelId: String
    let systemPromptId: String?
    let systemPromptInline: String?
    let userPromptId: String?
    let userPromptInline: String?
}

struct AutomationNotification: Codable {
    let onComplete: Bool
    let onFailure: Bool
}

struct Automation: Codable, Identifiable {
    let id: String
    let name: String
    let enabled: Bool
    let projectId: String?
    let trigger: AutomationTrigger
    let action: AutomationAction
    let notification: AutomationNotification
    let workspacePath: String?
    let lastRunId: String?
    let lastRunAt: String?
    let lastRunStatus: AutomationRunStatus?
    let createdAt: String
    let updatedAt: String
}

struct AutomationRun: Codable, Identifiable {
    let id: String
    let automationId: String
    let status: AutomationRunStatus
    let sessionId: String
    let startedAt: String
    let completedAt: String?
    let durationMs: Int?
    let summary: String?
    let error: String?
}

struct PromptTemplate: Codable, Identifiable {
    let id: String
    let name: String
    let type: String
    let content: String
    let createdAt: String
    let updatedAt: String
}

// MARK: - Task Tracking

enum TaskStatus: String {
    case pending
    case inProgress = "in_progress"
    case completed
}

struct TrackedTask: Identifiable {
    let id: String
    var subject: String
    var description: String?
    var activeForm: String?
    var status: TaskStatus
    var isCreating: Bool
}

struct TaskCounts {
    let total: Int
    let completed: Int
    let inProgress: Int
    let pending: Int
}

struct TasksState {
    let tasks: [TrackedTask]
    let currentTask: TrackedTask?
    let counts: TaskCounts

    static let empty = TasksState(
        tasks: [],
        currentTask: nil,
        counts: TaskCounts(total: 0, completed: 0, inProgress: 0, pending: 0)
    )
}
