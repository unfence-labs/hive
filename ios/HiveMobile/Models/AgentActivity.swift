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
        case .diagnostic(let activity): activity.id
        case .unknown(let activity): activity.id
        }
    }

    var kind: String {
        switch self {
        case .commandExecution: "command_execution"
        case .fileChange: "file_change"
        case .planUpdate: "plan_update"
        case .diagnostic: "diagnostic"
        case .unknown(let activity): activity.kind
        }
    }

    private enum CodingKeys: String, CodingKey {
        case id, kind
        case command, cwd, status, output, exitCode, durationMs, commandActions
        case files
        case steps
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
        case .planUpdate, .diagnostic, .unknown:
            return []
        }
    }
}

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

func visibleAgentActivities(_ activities: [AgentActivity]) -> [AgentActivity] {
    activities.filter { $0.toolCalls.isEmpty }
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
