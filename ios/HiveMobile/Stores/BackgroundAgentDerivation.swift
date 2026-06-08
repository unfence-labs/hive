import Foundation

// MARK: - Background Agent Derivation
//
// Pure function port of `frontend/src/hooks/useBackgroundAgents.ts`.

/// Derive background sub-agents (Task/Agent tools with `run_in_background`)
/// and their running state from history + active (streaming) tool calls.
func deriveBackgroundAgents(
    from messages: [ChatMessage],
    activeToolCalls: [ToolCall]
) -> BackgroundAgentsState {
    // De-duplicate tools by id, preserving first-seen order (mirrors the JS Map).
    var toolsById: [String: ToolCall] = [:]
    var order: [String] = []
    func upsert(_ tool: ToolCall) {
        if toolsById[tool.id] == nil { order.append(tool.id) }
        toolsById[tool.id] = tool
    }
    for message in messages {
        for tool in message.toolCalls ?? [] { upsert(tool) }
    }
    for tool in activeToolCalls { upsert(tool) }

    let allTools = order.compactMap { toolsById[$0] }
    let childrenMap = buildChildrenMap(allTools)
    let activeToolIds = Set(activeToolCalls.map(\.id))

    var agents: [BackgroundAgent] = []
    for tool in allTools {
        guard tool.name == "Task" || tool.name == "Agent" else { continue }
        guard let info = parseSubAgentInfo(tool), info.runInBackground else { continue }
        if let collabTool = info.tool, collabTool != "spawnAgent" { continue }

        let showExecutingState = activeToolIds.contains(tool.id)
            || hasActiveChild(tool.id, childrenMap: childrenMap, activeToolIds: activeToolIds)
        let isRunning = subAgentExecutionState(
            for: tool,
            children: childrenMap[tool.id] ?? [],
            childrenByParentId: childrenMap,
            showExecutingState: showExecutingState
        ) == .running

        agents.append(BackgroundAgent(
            toolId: tool.id,
            subagentType: info.subagentType,
            description: info.description,
            model: info.model,
            isRunning: isRunning
        ))
    }

    guard !agents.isEmpty else { return .empty }
    return BackgroundAgentsState(
        agents: agents,
        runningCount: agents.filter(\.isRunning).count
    )
}

private func hasActiveChild(
    _ toolId: String,
    childrenMap: [String: [ToolCall]],
    activeToolIds: Set<String>
) -> Bool {
    let children = childrenMap[toolId] ?? []
    return children.contains { child in
        activeToolIds.contains(child.id)
            || hasActiveChild(child.id, childrenMap: childrenMap, activeToolIds: activeToolIds)
    }
}
