import Foundation

// MARK: - Task Derivation
//
// Pure function that derives task tracking state from tool calls.
// Direct port of frontend/src/hooks/useTasks.ts.

private let validStatuses: Set<String> = ["pending", "in_progress", "completed"]

/// Parse a task ID from a TaskCreate tool output string.
/// Tries JSON `{ "task": { "id": "42" } }` first, then regex `Task #1 created...`.
func parseTaskId(from output: String) -> String? {
    // Try JSON first
    if let data = output.data(using: .utf8),
       let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
       let task = json["task"] as? [String: Any],
       let id = task["id"] {
        return "\(id)"
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
    guard let data = tool.input.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        return [:]
    }
    return obj
}

/// Derive task tracking state from conversation messages and active (streaming) tool calls.
/// Mirrors the logic in `frontend/src/hooks/useTasks.ts` exactly.
func deriveTasks(from messages: [ChatMessage], activeToolCalls: [ToolCall]) -> TasksState {
    // Collect all tool calls in chronological order
    var allTools: [ToolCall] = []
    for msg in messages {
        if let tools = msg.toolCalls {
            allTools.append(contentsOf: tools)
        }
    }
    allTools.append(contentsOf: activeToolCalls)

    // Quick bail: no task tools at all
    let hasTaskTools = allTools.contains { $0.name == "TaskCreate" || $0.name == "TaskUpdate" }
    guard hasTaskTools else { return .empty }

    // Ordered storage: array of (key, task) pairs + index lookup
    var tasks: [(key: String, value: TrackedTask)] = []
    var taskIndex: [String: Int] = [:]
    var createIndex = 0

    for tool in allTools {
        if tool.name == "TaskCreate" {
            createIndex += 1
            let input = parseInput(tool)
            let subject = (input["subject"] as? String) ?? "Task \(createIndex)"
            let description = input["description"] as? String
            let activeForm = input["activeForm"] as? String

            let id: String
            var isCreating = false

            if let output = tool.output {
                let parsed = parseTaskId(from: output)
                id = parsed ?? "_idx_\(createIndex)"
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
            taskIndex[id] = tasks.count
            tasks.append((key: id, value: task))

        } else if tool.name == "TaskUpdate" {
            let input = parseInput(tool)
            guard let taskId = input["taskId"] as? String,
                  let idx = taskIndex[taskId] else { continue }

            let statusStr = input["status"] as? String
            if statusStr == "deleted" {
                tasks.remove(at: idx)
                taskIndex.removeValue(forKey: taskId)
                // Rebuild indices for items after removed position
                for i in idx..<tasks.count {
                    taskIndex[tasks[i].key] = i
                }
                continue
            }

            if let s = input["subject"] as? String { tasks[idx].value.subject = s }
            if let d = input["description"] as? String { tasks[idx].value.description = d }
            if let a = input["activeForm"] as? String { tasks[idx].value.activeForm = a }
            if let s = statusStr, validStatuses.contains(s),
               let status = TaskStatus(rawValue: s) {
                tasks[idx].value.status = status
            }
        }
    }

    let taskList = tasks.map(\.value)
    let currentTask = taskList.first { $0.status == .inProgress }
    let counts = TaskCounts(
        total: taskList.count,
        completed: taskList.filter { $0.status == .completed }.count,
        inProgress: taskList.filter { $0.status == .inProgress }.count,
        pending: taskList.filter { $0.status == .pending }.count
    )

    return TasksState(tasks: taskList, currentTask: currentTask, counts: counts)
}
