import Foundation

struct AgentActivityFile: Codable, Equatable, Identifiable {
    let path: String
    let diff: String?
    let kind: String?
    let status: String?

    var id: String { "\(path):\(kind ?? ""):\(status ?? "")" }
}

struct AgentActivityPlanStep: Codable, Equatable {
    let text: String
    let status: String
}

struct AgentActivityCommandAction: Codable, Equatable {
    let type: String
    let command: String?
    let name: String?
    let path: String?
    let query: String?
}

enum AgentActivitySeverity: String, Codable, Equatable {
    case info
    case warning
    case error
}

enum AgentActivity: Codable, Equatable, Identifiable {
    case commandExecution(CommandExecution)
    case fileChange(FileChange)
    case planUpdate(PlanUpdate)
    case goalUpdate(GoalUpdate)
    case imageView(ImageView)
    case imageGeneration(ImageGeneration)
    case diagnostic(Diagnostic)
    case unknown(Unknown)

    struct CommandExecution: Codable, Equatable, Identifiable {
        let id: String
        let command: String?
        let cwd: String?
        let status: String?
        let output: String?
        let exitCode: Int?
        let durationMs: Int?
        let commandActions: [AgentActivityCommandAction]?

        init(
            id: String,
            command: String?,
            cwd: String?,
            status: String?,
            output: String?,
            exitCode: Int?,
            durationMs: Int?,
            commandActions: [AgentActivityCommandAction]? = nil
        ) {
            self.id = id
            self.command = command
            self.cwd = cwd
            self.status = status
            self.output = output
            self.exitCode = exitCode
            self.durationMs = durationMs
            self.commandActions = commandActions
        }
    }

    struct FileChange: Codable, Equatable, Identifiable {
        let id: String
        let status: String?
        let files: [AgentActivityFile]
    }

    struct PlanUpdate: Codable, Equatable, Identifiable {
        let id: String
        let steps: [AgentActivityPlanStep]
    }

    struct GoalUpdate: Codable, Equatable, Identifiable {
        let id: String
        let active: Bool
        let threadId: String
        let objective: String?
        let status: String?
        let tokenBudget: Int?
        let tokensUsed: Int?
        let timeUsedSeconds: Int?
        let createdAt: Int?
        let updatedAt: Int?
    }

    struct ImageView: Codable, Equatable, Identifiable {
        let id: String
        let path: String
        let relativePath: String?
        let imageUrl: String?
        let outsideWorkspace: Bool?
    }

    struct ImageGeneration: Codable, Equatable, Identifiable {
        let id: String
        let status: String?
        let revisedPrompt: String?
        let result: String?
        let savedPath: String?
        let relativePath: String?
        let imageUrl: String?
    }

    struct Diagnostic: Codable, Equatable, Identifiable {
        let id: String
        let severity: AgentActivitySeverity
        let title: String
        let message: String
        let source: String?
        let method: String?
        let details: String?
    }

    struct Unknown: Codable, Equatable, Identifiable {
        let id: String
        let kind: String
    }

    var id: String {
        switch self {
        case .commandExecution(let activity): activity.id
        case .fileChange(let activity): activity.id
        case .planUpdate(let activity): activity.id
        case .goalUpdate(let activity): activity.id
        case .imageView(let activity): activity.id
        case .imageGeneration(let activity): activity.id
        case .diagnostic(let activity): activity.id
        case .unknown(let activity): activity.id
        }
    }

    var kind: String {
        switch self {
        case .commandExecution: "command_execution"
        case .fileChange: "file_change"
        case .planUpdate: "plan_update"
        case .goalUpdate: "goal_update"
        case .imageView: "image_view"
        case .imageGeneration: "image_generation"
        case .diagnostic: "diagnostic"
        case .unknown(let activity): activity.kind
        }
    }

    private enum CodingKeys: String, CodingKey {
        case id, kind
        case command, cwd, status, output, exitCode, durationMs, commandActions
        case files
        case steps
        case active, threadId, objective, tokenBudget, tokensUsed, timeUsedSeconds, createdAt, updatedAt
        case path, relativePath, imageUrl, outsideWorkspace, revisedPrompt, result, savedPath
        case severity, title, message, source, method, details
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decode(String.self, forKey: .kind)

        switch kind {
        case "command_execution":
            self = .commandExecution(try CommandExecution(from: decoder))
        case "file_change":
            self = .fileChange(try FileChange(from: decoder))
        case "plan_update":
            self = .planUpdate(try PlanUpdate(from: decoder))
        case "goal_update":
            self = .goalUpdate(try GoalUpdate(from: decoder))
        case "image_view":
            self = .imageView(try ImageView(from: decoder))
        case "image_generation":
            self = .imageGeneration(try ImageGeneration(from: decoder))
        case "diagnostic":
            self = .diagnostic(try Diagnostic(from: decoder))
        default:
            let id = (try? container.decode(String.self, forKey: .id)) ?? "unknown-\(kind)"
            self = .unknown(Unknown(id: id, kind: kind))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(kind, forKey: .kind)

        switch self {
        case .commandExecution(let activity):
            try container.encode(activity.id, forKey: .id)
            try container.encodeIfPresent(activity.command, forKey: .command)
            try container.encodeIfPresent(activity.cwd, forKey: .cwd)
            try container.encodeIfPresent(activity.status, forKey: .status)
            try container.encodeIfPresent(activity.output, forKey: .output)
            try container.encodeIfPresent(activity.exitCode, forKey: .exitCode)
            try container.encodeIfPresent(activity.durationMs, forKey: .durationMs)
            try container.encodeIfPresent(activity.commandActions, forKey: .commandActions)
        case .fileChange(let activity):
            try container.encode(activity.id, forKey: .id)
            try container.encodeIfPresent(activity.status, forKey: .status)
            try container.encode(activity.files, forKey: .files)
        case .planUpdate(let activity):
            try container.encode(activity.id, forKey: .id)
            try container.encode(activity.steps, forKey: .steps)
        case .goalUpdate(let activity):
            try container.encode(activity.id, forKey: .id)
            try container.encode(activity.active, forKey: .active)
            try container.encode(activity.threadId, forKey: .threadId)
            try container.encodeIfPresent(activity.objective, forKey: .objective)
            try container.encodeIfPresent(activity.status, forKey: .status)
            try container.encodeIfPresent(activity.tokenBudget, forKey: .tokenBudget)
            try container.encodeIfPresent(activity.tokensUsed, forKey: .tokensUsed)
            try container.encodeIfPresent(activity.timeUsedSeconds, forKey: .timeUsedSeconds)
            try container.encodeIfPresent(activity.createdAt, forKey: .createdAt)
            try container.encodeIfPresent(activity.updatedAt, forKey: .updatedAt)
        case .imageView(let activity):
            try container.encode(activity.id, forKey: .id)
            try container.encode(activity.path, forKey: .path)
            try container.encodeIfPresent(activity.relativePath, forKey: .relativePath)
            try container.encodeIfPresent(activity.imageUrl, forKey: .imageUrl)
            try container.encodeIfPresent(activity.outsideWorkspace, forKey: .outsideWorkspace)
        case .imageGeneration(let activity):
            try container.encode(activity.id, forKey: .id)
            try container.encodeIfPresent(activity.status, forKey: .status)
            try container.encodeIfPresent(activity.revisedPrompt, forKey: .revisedPrompt)
            try container.encodeIfPresent(activity.result, forKey: .result)
            try container.encodeIfPresent(activity.savedPath, forKey: .savedPath)
            try container.encodeIfPresent(activity.relativePath, forKey: .relativePath)
            try container.encodeIfPresent(activity.imageUrl, forKey: .imageUrl)
        case .diagnostic(let activity):
            try container.encode(activity.id, forKey: .id)
            try container.encode(activity.severity, forKey: .severity)
            try container.encode(activity.title, forKey: .title)
            try container.encode(activity.message, forKey: .message)
            try container.encodeIfPresent(activity.source, forKey: .source)
            try container.encodeIfPresent(activity.method, forKey: .method)
            try container.encodeIfPresent(activity.details, forKey: .details)
        case .unknown(let activity):
            try container.encode(activity.id, forKey: .id)
        }
    }
}

extension AgentActivity {
    var toolCalls: [ToolCall] {
        switch self {
        case .commandExecution(let activity):
            return [toolCall(for: activity)]
        case .fileChange(let activity):
            if activity.files.isEmpty {
                return [
                    ToolCall(
                        id: activity.id,
                        name: "Edit",
                        input: encodeToolInput([
                            "filename": "",
                            "diff": "",
                            "status": activity.status
                        ]),
                        output: activity.status,
                        parentToolUseId: nil
                    )
                ]
            }

            return activity.files.enumerated().map { index, file in
                ToolCall(
                    id: "\(activity.id):\(index):\(file.path)",
                    name: "Edit",
                    input: encodeToolInput([
                        "filename": file.path,
                        "diff": file.diff ?? "",
                        "kind": file.kind,
                        "status": file.status ?? activity.status
                    ]),
                    output: file.diff ?? file.status ?? activity.status,
                    parentToolUseId: nil
                )
            }
        case .planUpdate, .goalUpdate, .imageView, .imageGeneration, .diagnostic, .unknown:
            return []
        }
    }
}

enum VisibleAgentActivity: Equatable, Identifiable {
    case imageView(AgentActivity.ImageView)
    case imageGeneration(AgentActivity.ImageGeneration)
    case diagnostic(AgentActivity.Diagnostic)
    case unknown(AgentActivity.Unknown)

    init?(_ activity: AgentActivity) {
        guard activity.toolCalls.isEmpty else { return nil }
        switch activity {
        case .imageView(let image):
            self = .imageView(image)
        case .imageGeneration(let image):
            self = .imageGeneration(image)
        case .diagnostic(let diagnostic):
            self = .diagnostic(diagnostic)
        case .unknown(let unknown):
            self = .unknown(unknown)
        case .commandExecution, .fileChange, .planUpdate, .goalUpdate:
            // Goal updates drive the task tracker (like plan updates), not the
            // inline activity list — keep them out of the visible feed.
            return nil
        }
    }

    var id: String {
        switch self {
        case .imageView(let activity): activity.id
        case .imageGeneration(let activity): activity.id
        case .diagnostic(let activity): activity.id
        case .unknown(let activity): activity.id
        }
    }
}

// MARK: - Image Activity Logic

/// Pure helpers mirroring `frontend/src/components/chat/ImageActivity.tsx` so the
/// view layer stays declarative and the resolution rules stay testable.

extension AgentActivity.ImageView {
    /// Resolved source for the viewed image, or nil when there is no preview
    /// (outside the workspace). Mirrors `resolveImageViewSrc`.
    var resolvedSource: String? {
        guard let url = imageUrl, !url.isEmpty else { return nil }
        return url
    }
}

extension AgentActivity.ImageGeneration {
    /// Resolved source for a generated image: prefer the workspace raw-file URL,
    /// fall back to the inline base64 result. Mirrors `imageGenerationSrc`.
    var resolvedSource: String? {
        if let url = imageUrl, !url.isEmpty { return url }
        guard let result, !result.isEmpty else { return nil }
        return result.hasPrefix("data:") ? result : "data:image/png;base64,\(result)"
    }

    /// A generation is pending while a turn is live (`showExecutingState`), its
    /// status is non-terminal, and no image is resolvable yet. Mirrors
    /// `isGenerationPending`.
    func isPending(showExecutingState: Bool) -> Bool {
        if resolvedSource != nil { return false }
        let status = status?.lowercased()
        let terminal = status == "completed" || status == "failed" || status == "error"
        return showExecutingState && !terminal
    }
}

/// Last path component of an image path. Mirrors `fileName`.
func imageActivityFileName(_ path: String) -> String {
    (path as NSString).lastPathComponent
}

/// Whitespace-collapsed, 64-char prompt preview. Mirrors `promptPreview`.
func imagePromptPreview(_ prompt: String?) -> String? {
    let normalized = prompt?
        .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        .trimmingCharacters(in: .whitespacesAndNewlines)
    guard let normalized, !normalized.isEmpty else { return nil }
    return normalized.count > 64 ? String(normalized.prefix(64)) + "..." : normalized
}

/// The active Codex goal, mirroring `frontend/src/hooks/useGoalState.ts` where
/// `GoalState` is the `goal_update` activity itself.
typealias GoalState = AgentActivity.GoalUpdate

private func toolCall(for activity: AgentActivity.CommandExecution) -> ToolCall {
    let classified = classifiedCommandAction(for: activity)
    return ToolCall(
        id: activity.id,
        name: classified?.name ?? "Bash",
        input: encodeToolInput(classified?.input ?? [
            "command": activity.command ?? "",
            "cwd": activity.cwd,
            "status": activity.status,
            "exitCode": activity.exitCode,
            "durationMs": activity.durationMs
        ]),
        output: activity.output,
        parentToolUseId: nil
    )
}

private func classifiedCommandAction(
    for activity: AgentActivity.CommandExecution
) -> (name: String, input: [String: Any?])? {
    guard let actions = activity.commandActions, actions.count == 1, let action = actions.first else {
        return nil
    }

    let command = action.command ?? activity.command
    let metadata: [String: Any?] = [
        "command": command,
        "cwd": activity.cwd,
        "status": activity.status,
        "exitCode": activity.exitCode,
        "durationMs": activity.durationMs
    ]

    switch action.type {
    case "read":
        guard let path = action.path, !path.isEmpty else { return nil }
        return ("Read", metadata.merging([
            "file_path": path,
            "path": path,
            "name": action.name
        ]) { current, _ in current })
    case "search":
        guard let query = action.query, !query.isEmpty else { return nil }
        return ("Grep", metadata.merging([
            "pattern": query,
            "path": action.path
        ]) { current, _ in current })
    case "listFiles":
        return ("Glob", metadata.merging([
            "path": action.path
        ]) { current, _ in current })
    default:
        return nil
    }
}

func mergeToolCalls(_ toolCalls: [ToolCall], with activities: [AgentActivity]) -> [ToolCall] {
    var merged = toolCalls
    var existingIds = Set(toolCalls.map(\.id))

    for activity in activities {
        if existingIds.contains(activity.id) { continue }

        for toolCall in activity.toolCalls where !existingIds.contains(toolCall.id) {
            merged.append(toolCall)
            existingIds.insert(toolCall.id)
        }
    }

    return merged
}

func visibleAgentActivities(_ activities: [AgentActivity]) -> [VisibleAgentActivity] {
    activities.compactMap(VisibleAgentActivity.init)
}

private func encodeToolInput(_ values: [String: Any?]) -> String {
    let object = values.reduce(into: [String: Any]()) { result, entry in
        if let value = entry.value {
            result[entry.key] = value
        }
    }

    guard JSONSerialization.isValidJSONObject(object),
          let data = try? JSONSerialization.data(withJSONObject: object),
          let text = String(data: data, encoding: .utf8) else {
        return "{}"
    }
    return text
}
