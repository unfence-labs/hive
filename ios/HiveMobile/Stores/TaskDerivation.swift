import Foundation

// MARK: - Task Derivation
//
// Pure function that derives task tracking state from tool calls.
// Direct port of frontend/src/hooks/useTasks.ts.

private let validStatuses: Set<String> = ["pending", "in_progress", "completed", "failed", "declined"]
private let taskToolNames: Set<String> = ["TaskCreate", "TaskUpdate", "TodoList"]

private enum PlanActivitySource: Equatable {
    case history
    case active
}

/// Parse a task ID from a TaskCreate tool output string.
/// Tries JSON `{ "task": { "id": "42" } }` first, then regex `Task #1 created...`.
func parseTaskId(from output: String) -> String? {
    // Try JSON first (various shapes depending on CLI version)
    if let data = output.data(using: .utf8),
       let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
        let id = (json["task"] as? [String: Any])?["id"] ?? json["taskId"] ?? json["id"]
        if let id = id {
            return "\(id)"
        }
    }
    // Regex fallback: case-insensitive "Task #1" or "Task 1"
    if let match = output.range(of: #"Task\s+#?(\d+)"#, options: [.regularExpression, .caseInsensitive]) {
        // Extract just the digits from the match
        let matched = String(output[match])
        if let digitMatch = matched.range(of: #"\d+"#, options: .regularExpression) {
            return String(matched[digitMatch])
        }
    }
    return nil
}

private func parseInput(_ tool: ToolCall) -> [String: Any] {
    parsedToolInputObject(tool.input) ?? [:]
}

private func parseTodoList(_ tool: ToolCall) -> [(text: String, completed: Bool)] {
    let source = tool.output ?? tool.input
    guard let obj = parsedToolInputObject(source),
          let items = obj["items"] as? [[String: Any]] else {
        return []
    }

    return items.compactMap { item in
        guard let text = item["text"] as? String, !text.isEmpty else { return nil }
        return (text: text, completed: (item["completed"] as? Bool) ?? false)
    }
}

private func normalizeTaskStatus(_ value: String?) -> TaskStatus? {
    guard let value else { return nil }
    if value == "inProgress" { return .inProgress }
    guard validStatuses.contains(value) else { return nil }
    return TaskStatus(rawValue: value)
}

private func planTasks(from activity: AgentActivity.PlanUpdate) -> [TrackedTask] {
    activity.steps.enumerated().compactMap { index, step in
        let subject = step.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !subject.isEmpty else { return nil }
        return TrackedTask(
            id: "\(activity.id)-\(index + 1)",
            subject: subject,
            status: normalizeTaskStatus(step.status) ?? .pending,
            isCreating: false
        )
    }
}

private func hasOpenPlanTask(_ tasks: [TrackedTask], activityId: String) -> Bool {
    tasks.contains { task in
        task.id.hasPrefix("\(activityId)-") && (task.status == .pending || task.status == .inProgress)
    }
}

struct TasksHistorySnapshot {
    fileprivate var tasks: [(key: String, value: TrackedTask)] = []
    fileprivate var taskIndex: [String: Int] = [:]
    fileprivate var createIndex = 0
    fileprivate var planActivities: [(plan: AgentActivity.PlanUpdate, source: PlanActivitySource)] = []
    fileprivate var hasTaskTools = false

    static let empty = TasksHistorySnapshot()
}

func deriveTasksHistory(from messages: [ChatMessage]) -> TasksHistorySnapshot {
    var state = TasksHistorySnapshot()
    for msg in messages {
        for tool in msg.toolCalls ?? [] {
            applyTaskTool(tool, to: &state)
        }
        for activity in msg.agentActivities ?? [] {
            if case .planUpdate(let plan) = activity {
                state.planActivities.append((plan: plan, source: .history))
            }
        }
    }
    return state
}

/// Derive task tracking state from conversation messages and active (streaming) tool calls.
/// Mirrors the logic in `frontend/src/hooks/useTasks.ts` exactly.
func deriveTasks(
    from messages: [ChatMessage],
    activeToolCalls: [ToolCall],
    activeAgentActivities: [AgentActivity] = []
) -> TasksState {
    deriveTasks(
        history: deriveTasksHistory(from: messages),
        activeToolCalls: activeToolCalls,
        activeAgentActivities: activeAgentActivities
    )
}

func deriveTasks(
    history: TasksHistorySnapshot,
    activeToolCalls: [ToolCall],
    activeAgentActivities: [AgentActivity] = []
) -> TasksState {
    var state = history
    for tool in activeToolCalls {
        applyTaskTool(tool, to: &state)
    }
    for activity in activeAgentActivities {
        if case .planUpdate(let plan) = activity {
            state.planActivities.append((plan: plan, source: .active))
        }
    }

    // Quick bail: no task tools at all
    guard state.hasTaskTools || !state.planActivities.isEmpty else { return .empty }

    // Codex app-server emits plan updates as agent activities, not tool calls.
    // The latest plan represents the current turn, so older plans should not
    // accumulate in the global task tracker.
    let latestPlanEntry = state.planActivities.last
    if let latestPlanEntry {
        for task in planTasks(from: latestPlanEntry.plan) {
            let key = "plan:\(task.id)"
            if let existingIndex = state.taskIndex[key] {
                state.tasks[existingIndex].value = task
            } else {
                state.taskIndex[key] = state.tasks.count
                state.tasks.append((key: key, value: task))
            }
        }
    }

    let taskList = state.tasks.map(\.value)
    let currentTask = taskList.first { $0.status == .inProgress }
    let counts = TaskCounts(
        total: taskList.count,
        completed: taskList.filter { $0.status == .completed }.count,
        inProgress: taskList.filter { $0.status == .inProgress }.count,
        pending: taskList.filter { $0.status == .pending }.count
    )
    let trackerSource: TaskTrackerSource? = latestPlanEntry != nil ? .codexPlan : (state.hasTaskTools ? .taskTools : nil)
    // A persisted Codex plan with open steps is only the last reported snapshot,
    // not proof that the finished turn still has work remaining.
    let hasUnconfirmedOpenPlanTasks: Bool
    if let latestPlanEntry, latestPlanEntry.source == .history {
        hasUnconfirmedOpenPlanTasks = hasOpenPlanTask(taskList, activityId: latestPlanEntry.plan.id)
    } else {
        hasUnconfirmedOpenPlanTasks = false
    }
    let trackerStatus: TaskTrackerStatus = hasUnconfirmedOpenPlanTasks ? .unconfirmed : .live

    return TasksState(
        tasks: taskList,
        currentTask: currentTask,
        counts: counts,
        trackerSource: trackerSource,
        trackerStatus: trackerStatus
    )
}

private func applyTaskTool(_ tool: ToolCall, to state: inout TasksHistorySnapshot) {
    guard taskToolNames.contains(tool.name) else { return }
    state.hasTaskTools = true

    if tool.name == "TaskCreate" {
        state.createIndex += 1
        let input = parseInput(tool)
        let subject = (input["subject"] as? String) ?? "Task \(state.createIndex)"
        let description = input["description"] as? String
        let activeForm = input["activeForm"] as? String

        let id: String
        var isCreating = false

        if let output = tool.output {
            let parsed = parseTaskId(from: output)
            id = parsed ?? "_idx_\(state.createIndex)"
        } else {
            // Still streaming — use tool_use id as temp key
            id = "_pending_\(tool.id)"
            isCreating = true
        }

        let task = TrackedTask(
            id: id,
            subject: subject,
            description: description,
            activeForm: activeForm,
            status: .pending,
            isCreating: isCreating
        )
        state.taskIndex[id] = state.tasks.count
        state.tasks.append((key: id, value: task))

    } else if tool.name == "TaskUpdate" {
        let input = parseInput(tool)
        guard let taskId = input["taskId"] as? String,
              let idx = state.taskIndex[taskId] else { return }

        let statusStr = input["status"] as? String
        if statusStr == "deleted" {
            state.tasks.remove(at: idx)
            state.taskIndex.removeValue(forKey: taskId)
            // Rebuild indices for items after removed position
            for i in idx..<state.tasks.count {
                state.taskIndex[state.tasks[i].key] = i
            }
            return
        }

        if let s = input["subject"] as? String { state.tasks[idx].value.subject = s }
        if let d = input["description"] as? String { state.tasks[idx].value.description = d }
        if let a = input["activeForm"] as? String { state.tasks[idx].value.activeForm = a }
        if let status = normalizeTaskStatus(statusStr) {
            state.tasks[idx].value.status = status
        }
    } else if tool.name == "TodoList" {
        for (index, item) in parseTodoList(tool).enumerated() {
            let id = "codex-todo-\(index + 1)"
            let task = TrackedTask(
                id: id,
                subject: item.text,
                status: item.completed ? .completed : .pending,
                isCreating: false
            )

            if let existingIndex = state.taskIndex[id] {
                state.tasks[existingIndex].value = task
            } else {
                state.taskIndex[id] = state.tasks.count
                state.tasks.append((key: id, value: task))
            }
        }
    }
}
