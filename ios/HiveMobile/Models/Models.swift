import Foundation

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
    case unstable
    case unknown
}

enum ChecksStatus: String, Codable {
    case pending
    case success
    case failure
}

enum DiffFileStatus: String, Codable {
    case added
    case modified
    case deleted
    case renamed
}

// MARK: - Project & Workspace

struct Project: Codable, Identifiable {
    let id: String
    let name: String
    let url: String
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
}

// MARK: - Branch & PR

struct PullRequestInfo: Codable {
    let number: Int
    let url: String
    let state: PRState
    let mergeable: Bool?
    let mergeableState: MergeableState
    let checksStatus: ChecksStatus
}

struct BranchInfo: Codable {
    let name: String
    let lastSyncedAt: String
    let pr: PullRequestInfo?
    let prSyncError: String?
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

    var id: String { sessionId }
}

struct ImageAttachment: Codable {
    let name: String
    let mediaType: String
    let dataUrl: String
}

struct ToolCall: Codable, Identifiable {
    let id: String
    let name: String
    let input: String
    let output: String?
    let parentToolUseId: String?
}

struct ChatMessage: Codable, Identifiable {
    let id: String
    let sessionId: String
    let role: MessageRole
    let content: String
    let images: [ImageAttachment]?
    let toolCalls: [ToolCall]?
    let thinkingContent: String?
    let timestamp: String
    let cancelled: Bool?
    let durationMs: Int?
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

struct MessageOptions: Codable {
    let planMode: Bool?
    let thinkingEnabled: Bool?
}
