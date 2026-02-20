import Foundation

// MARK: - Enums

enum ClaudeModel: String, CaseIterable, Identifiable, Codable {
    case opus = "claude-opus-4-6"
    case sonnet = "claude-sonnet-4-5-20250929"
    case haiku = "claude-haiku-4-5-20251001"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .opus: "Opus 4.6"
        case .sonnet: "Sonnet 4.5"
        case .haiku: "Haiku 4.5"
        }
    }
}

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

struct ImageAttachment: Codable, Equatable {
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
    let toolCalls: [ToolCall]?
    let thinkingContent: String?
    let timestamp: String
    let cancelled: Bool?
    let durationMs: Int?

    init(id: String, sessionId: String, role: MessageRole, content: String,
         images: [ImageAttachment]?, toolCalls: [ToolCall]?, thinkingContent: String?,
         timestamp: String, cancelled: Bool?, durationMs: Int?) {
        self.id = id
        self.sessionId = sessionId
        self.role = role
        self.content = content
        self.images = images
        self.toolCalls = toolCalls
        self.thinkingContent = thinkingContent
        self.timestamp = timestamp
        self.cancelled = cancelled
        self.durationMs = durationMs
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        sessionId = try container.decode(String.self, forKey: .sessionId)
        role = try container.decode(MessageRole.self, forKey: .role)
        content = try container.decode(String.self, forKey: .content)
        images = try container.decodeIfPresent([ImageAttachment].self, forKey: .images)
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
    }

    private enum CodingKeys: String, CodingKey {
        case id, sessionId, role, content, images, toolCalls
        case thinkingContent, timestamp, cancelled, durationMs
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

struct MessageOptions: Codable {
    let planMode: Bool?
    let thinkingEnabled: Bool?
    let model: String?
}
