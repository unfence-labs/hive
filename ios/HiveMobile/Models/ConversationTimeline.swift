import Foundation
import Observation

/// Ordered references share payloads with the legacy message fields.
/// A missing timeline means legacy history; an empty timeline is a new, empty turn.
struct ConversationTimelineEntry: Codable, Equatable, Identifiable {
    enum Kind: String, Codable {
        case text, reasoning, tool, activity
    }

    let type: Kind
    let id: String
    var text: String?
    var identity: String { "\(type.rawValue):\(id)" }

    init(type: Kind, id: String, text: String? = nil) {
        self.type = type
        self.id = id
        self.text = text
    }
}

struct ConversationTimelineGroup: Equatable, Identifiable {
    let id: String
    let isActionGroup: Bool
    var entries: [ConversationTimelineEntry]
}

extension ChatMessage {
    var timelineGroups: [ConversationTimelineGroup] {
        var groups: [ConversationTimelineGroup] = []
        let tools = Dictionary((toolCalls ?? []).map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        let activities = Dictionary((agentActivities ?? []).map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        for entry in timeline ?? [] {
            let isAction: Bool
            switch entry.type {
            case .tool:
                guard let tool = tools[entry.id], tool.parentToolUseId == nil,
                      !["TaskUpdate", "TodoList"].contains(tool.name) else { continue }
                isAction = !["AskUserQuestion", "ExitPlanMode"].contains(tool.name)
            case .activity:
                guard let activity = activities[entry.id] else { continue }
                switch activity {
                case .planUpdate, .goalUpdate: continue
                case .commandExecution, .fileChange, .subagentActivity: isAction = true
                default: isAction = false
                }
            case .text, .reasoning:
                isAction = false
            }
            if isAction, let last = groups.indices.last, groups[last].isActionGroup {
                groups[last].entries.append(entry)
            } else {
                groups.append(ConversationTimelineGroup(id: entry.identity, isActionGroup: isAction, entries: [entry]))
            }
        }
        return groups
    }

    func timelineTools(for entry: ConversationTimelineEntry) -> [ToolCall] {
        let tools = toolCalls ?? []
        switch entry.type {
        case .tool: return tools.filter { $0.id == entry.id }
        case .activity:
            guard let activity = agentActivities?.first(where: { $0.id == entry.id }) else { return [] }
            // Prefer the canonical tool payload when an activity also has a compatibility alias.
            return activity.toolCalls.map { alias in tools.first(where: { $0.id == alias.id }) ?? alias }
        default: return []
        }
    }

}

/// Owned by the conversation view so disclosure choices survive stream/history replacement.
@Observable
final class ConversationTimelineExpansion {
    private var expanded: Set<String> = []

    func contains(_ id: String) -> Bool { expanded.contains(id) }

    func toggle(_ id: String) {
        if !expanded.insert(id).inserted { expanded.remove(id) }
    }
}

struct ConversationTimelineActionSummary: Equatable {
    let count: Int
    let failedCount: Int
    let runningToolName: String?
    let completed: Bool

    init(tools: [ToolCall], streaming: Bool, allTools: [ToolCall] = []) {
        count = tools.count
        var descendants = tools
        var included = Set(tools.map(\.id))
        var index = 0
        while index < descendants.count {
            let parentId = descendants[index].id
            for child in allTools where child.parentToolUseId == parentId {
                if included.insert(child.id).inserted { descendants.append(child) }
            }
            index += 1
        }
        let childrenByParentId = buildChildrenMap(allTools)
        func agentState(_ tool: ToolCall) -> SubAgentExecutionState {
            subAgentExecutionState(
                for: tool, children: childrenByParentId[tool.id] ?? [],
                childrenByParentId: childrenByParentId, showExecutingState: streaming
            )
        }
        completed = descendants.allSatisfy { tool in
            if tool.name == "Task" || tool.name == "Agent" {
                return [.completed, .failed].contains(agentState(tool))
            }
            let status = parsedToolInputObject(tool.input)?["status"] as? String
            if ["inProgress", "in_progress", "running"].contains(status ?? "") { return false }
            return tool.output != nil || ["completed", "failed", "declined", "error"].contains(status ?? "")
        }
        failedCount = descendants.filter { tool in
            if tool.isError == true { return true }
            if (tool.name == "Task" || tool.name == "Agent"), agentState(tool) == .failed { return true }
            let input = parsedToolInputObject(tool.input)
            if let code = input?["exitCode"] as? Int, code != 0 { return true }
            return ["failed", "declined", "error"].contains(input?["status"] as? String ?? "")
        }.count
        runningToolName = streaming ? descendants.last(where: { tool in
            if tool.isError == true { return false }
            if tool.name == "Task" || tool.name == "Agent" { return agentState(tool) == .running }
            let status = parsedToolInputObject(tool.input)?["status"] as? String
            if let status { return ["inProgress", "in_progress", "running"].contains(status) }
            return tool.output == nil && tool.isError != true
        })?.name : nil
    }

    init(message: ChatMessage, group: ConversationTimelineGroup, streaming: Bool) {
        let summaries = group.entries.map { entry in
            ConversationTimelineActionSummary(
                tools: message.timelineTools(for: entry), streaming: streaming,
                allTools: message.toolCalls ?? []
            )
        }
        count = group.entries.count
        completed = summaries.allSatisfy(\.completed)
        runningToolName = summaries.last(where: { $0.runningToolName != nil })?.runningToolName
        failedCount = zip(group.entries, summaries).filter { entry, summary in
            if summary.failedCount > 0 { return true }
            guard entry.type == .activity,
                  let activity = message.agentActivities?.first(where: { $0.id == entry.id }) else { return false }
            if case .fileChange(let change) = activity {
                return ["failed", "error"].contains(change.status ?? "")
                    || change.files.contains { ["failed", "error"].contains($0.status ?? "") }
            }
            return false
        }.count
    }

    var label: String {
        let countLabel = "\(count) action\(count == 1 ? "" : "s")"
        if let runningToolName { return "\(runningToolName)… · \(countLabel)" }
        return "\(countLabel)\(completed && failedCount == 0 ? " completed" : "")"
    }
}

extension ChatMessage {
    var timelineSearchableText: String {
        (timeline ?? []).filter { $0.type == .text }.map {
            ConversationFindModel.searchableText($0.text ?? "", rendersMarkdown: true)
        }.joined(separator: "\n")
    }

    func timelineHighlight(for entryId: String, highlight: MessageFindHighlight?) -> MessageFindHighlight? {
        guard let highlight else { return nil }
        var offset = 0
        for entry in timeline ?? [] where entry.type == .text {
            let text = ConversationFindModel.searchableText(entry.text ?? "", rendersMarkdown: true)
            let length = (text as NSString).length
            if entry.id == entryId {
                var ranges: [Range<Int>] = []
                var activeOrdinal: Int?
                for (ordinal, range) in highlight.ranges.enumerated() {
                    let lower = max(range.lowerBound, offset)
                    let upper = min(range.upperBound, offset + length)
                    if lower < upper {
                        if highlight.activeOrdinal == ordinal { activeOrdinal = ranges.count }
                        ranges.append((lower - offset)..<(upper - offset))
                    }
                }
                return ranges.isEmpty ? nil : MessageFindHighlight(ranges: ranges, activeOrdinal: activeOrdinal)
            }
            offset += length + 1
        }
        return nil
    }
}
