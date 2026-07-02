import Foundation

enum SubAgentExecutionState: Equatable {
    case pending
    case running
    case completed
    case failed
}

private let runningAgentStatuses: Set<String> = ["pendinginit", "running", "interrupted"]
private let failedAgentStatuses: Set<String> = ["errored", "notfound", "failed"]

func subAgentExecutionState(
    for tool: ToolCall,
    children: [ToolCall] = [],
    childrenByParentId: [String: [ToolCall]] = [:],
    showExecutingState: Bool = false
) -> SubAgentExecutionState {
    guard tool.name == "Task" || tool.name == "Agent" else {
        return tool.output == nil ? .pending : .completed
    }

    let inputPayload = jsonObject(from: tool.input)
    let outputPayload = tool.output.flatMap(toolOutputPayload)
    let toolStatus = stringValue(outputPayload?["status"] ?? inputPayload?["status"]).map(normalizeStatus)
    let agentStatuses = agentStatuses(from: inputPayload) + agentStatuses(from: outputPayload)

    if toolStatus == "failed" || agentStatuses.contains(where: { failedAgentStatuses.contains($0) }) {
        return .failed
    }

    guard showExecutingState else {
        return tool.output == nil ? .pending : .completed
    }

    if tool.output == nil {
        return .running
    }

    let collabTool = stringValue(inputPayload?["tool"] ?? outputPayload?["tool"])
    if collabTool == "spawnAgent" && agentStatuses.contains(where: { runningAgentStatuses.contains($0) }) {
        return .running
    }

    if hasRunningDescendant(children, childrenByParentId: childrenByParentId) {
        return .running
    }

    return .completed
}

private func hasRunningDescendant(
    _ children: [ToolCall],
    childrenByParentId: [String: [ToolCall]]
) -> Bool {
    for child in children {
        let nestedChildren = childrenByParentId[child.id] ?? []
        if child.name == "Task" || child.name == "Agent" {
            if subAgentExecutionState(
                for: child,
                children: nestedChildren,
                childrenByParentId: childrenByParentId,
                showExecutingState: true
            ) == .running {
                return true
            }
        } else if child.output == nil || hasRunningDescendant(nestedChildren, childrenByParentId: childrenByParentId) {
            return true
        }
    }
    return false
}

private func agentStatuses(from payload: [String: Any]?) -> [String] {
    guard let payload else { return [] }
    let states = payload["agentsStates"] as? [String: Any] ?? payload["agents_states"] as? [String: Any]
    guard let states else { return [] }
    return states.values.compactMap { value in
        guard let status = (value as? [String: Any])?["status"] as? String else { return nil }
        return normalizeStatus(status)
    }
}

private func toolOutputPayload(_ output: String) -> [String: Any]? {
    if let direct = jsonObject(from: output) {
        return direct
    }

    // Codex collab results arrive as text content blocks whose text is a JSON payload.
    guard let array = jsonValue(from: output) as? [[String: Any]] else { return nil }
    for block in array {
        guard let text = block["text"] as? String, let payload = jsonObject(from: text) else { continue }
        return payload
    }
    return nil
}

private func jsonObject(from string: String) -> [String: Any]? {
    parsedToolInputObject(string)
}

private func jsonValue(from string: String) -> Any? {
    guard let data = string.data(using: .utf8) else { return nil }
    return try? JSONSerialization.jsonObject(with: data)
}

private func stringValue(_ value: Any?) -> String? {
    value as? String
}

private func normalizeStatus(_ status: String) -> String {
    status.replacingOccurrences(of: "_", with: "").lowercased()
}

// MARK: - Sub-Agent Metadata
//
// Port of `frontend/src/lib/sub-agent.ts` (`parseSubAgentInfo`, `buildChildrenMap`).

struct SubAgentInfo {
    let subagentType: String
    let description: String
    let prompt: String?
    let runInBackground: Bool
    let model: String?
    let tool: String?
}

/// Parse sub-agent metadata from a Task/Agent tool's input JSON.
func parseSubAgentInfo(_ tool: ToolCall) -> SubAgentInfo? {
    guard tool.name == "Task" || tool.name == "Agent" else { return nil }
    guard let input = jsonObject(from: tool.input) else { return nil }
    return SubAgentInfo(
        subagentType: (input["subagent_type"] as? String) ?? "Agent",
        description: (input["description"] as? String) ?? "",
        prompt: input["prompt"] as? String,
        runInBackground: (input["run_in_background"] as? Bool) == true,
        model: input["model"] as? String,
        tool: input["tool"] as? String
    )
}

/// Build a map of parentToolUseId → children for hierarchical rendering.
func buildChildrenMap(_ tools: [ToolCall]) -> [String: [ToolCall]] {
    var map: [String: [ToolCall]] = [:]
    for tool in tools {
        guard let parent = tool.parentToolUseId else { continue }
        map[parent, default: []].append(tool)
    }
    return map
}
