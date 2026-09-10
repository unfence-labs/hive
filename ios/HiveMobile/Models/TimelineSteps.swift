import Foundation

// MARK: - Timeline Steps
//
// Port of `frontend/src/lib/timeline-steps.ts`: turns one assistant message into
// prose rows, runs of steps and standalone steps. The view-model only describes
// steps (verbs, subject, status, stats); detail rendering reads `source`.

enum TimelineStepStatus: Equatable {
    case pending
    case running
    case completed
    case failed
}

enum TimelineStepKind: Equatable {
    case tool
    case agent
    case reasoning
    case question
    case plan
    case diagnostic
    case image
    case compaction
    case subagentActivity
    case prompt
    case result
}

enum TimelineStepSeverity: Equatable {
    case warning
    case error
}

enum TimelineStepSource: Equatable {
    case tool(ToolCall)
    case activity(AgentActivity)
    case reasoning([ReasoningSegment])
    case text(String, markdown: Bool)

    /// Row id prefix, matching the web `source.type` discriminator.
    var typeName: String {
        switch self {
        case .tool: "tool"
        case .activity: "activity"
        case .reasoning: "reasoning"
        case .text: "text"
        }
    }
}

struct TimelineStep: Identifiable, Equatable {
    let id: String
    var kind: TimelineStepKind
    /// SF Symbol name.
    var icon: String
    /// Present-tense sentence for the live line, e.g. "Reading", "Editing", "Running".
    var liveVerb: String
    /// Past-tense pill after the subject, e.g. "read", "edited", "ran".
    var verb: String
    /// Subject first: file name, truncated command, pattern, url, agent description, headline.
    var subject: String
    /// Full-length subject for tooltips (full path, full command).
    var subjectTitle: String? = nil
    var status: TimelineStepStatus
    var stats: ChatActivityStats? = nil
    /// Diagnostic steps only: trailing mark severity; info carries no mark.
    var severity: TimelineStepSeverity? = nil
    /// True when the step must never be folded inside a run: questions, plans and diagnostics only.
    var standalone: Bool
    /// Agent steps only: nested child steps built from parentToolUseId, in tool array order.
    var children: [TimelineStep] = []
    /// Source payload for the detail renderer; the view-model does not build detail content.
    var source: TimelineStepSource
}

enum TimelineRow: Identifiable, Equatable {
    case text(id: String, text: String)
    case run(id: String, steps: [TimelineStep])
    case step(id: String, step: TimelineStep)

    var id: String {
        switch self {
        case .text(let id, _): id
        case .run(let id, _): id
        case .step(let id, _): id
        }
    }
}

let runCollapseThreshold = 2

private let hiddenTools: Set<String> = ["TaskUpdate", "TodoList"]

/// Steps that need the user's attention or decision; everything else joins a run and its summary.
private func isStandalone(_ kind: TimelineStepKind) -> Bool {
    switch kind {
    case .question, .plan, .diagnostic: true
    default: false
    }
}

func buildTimelineRows(message: ChatMessage, streaming: Bool) -> [TimelineRow] {
    let toolCalls = message.toolCalls ?? []
    let activities = message.agentActivities ?? []
    let segments = message.reasoningSegments ?? []
    let context = BuildContext(streaming: streaming, childrenMap: buildChildrenMap(toolCalls))
    let hiddenPlanWriteId = toolCalls.contains { $0.name == "ExitPlanMode" } ? planWriteToolId(toolCalls) : nil
    func isTopLevelTool(_ tool: ToolCall) -> Bool {
        (tool.parentToolUseId ?? "").isEmpty && !hiddenTools.contains(tool.name) && tool.id != hiddenPlanWriteId
    }

    var builder = TimelineRowBuilder()

    guard let timeline = message.timeline else {
        if segments.contains(where: hasContent) {
            builder.step(reasoningStep(id: "reasoning", segments: segments, running: false))
        }
        builder.text(id: message.id, text: message.content)
        for tool in toolCalls where isTopLevelTool(tool) {
            builder.step(toolStep(tool, context: context))
        }
        for activity in activities {
            builder.activity(activity, streaming: streaming)
        }
        return builder.rows
    }

    let toolsById = Dictionary(toolCalls.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
    let activitiesById = Dictionary(activities.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
    for (index, entry) in timeline.enumerated() {
        switch entry.type {
        case .text:
            builder.text(id: entry.id, text: entry.text ?? "")
        case .tool:
            if let tool = toolsById[entry.id], isTopLevelTool(tool) {
                builder.step(toolStep(tool, context: context))
            }
        case .activity:
            if let activity = activitiesById[entry.id] {
                builder.activity(activity, streaming: streaming)
            }
        case .reasoning:
            let matching = segments.filter { $0.id == entry.id || $0.id.hasPrefix("\(entry.id):") }
            if matching.contains(where: hasContent) {
                let isLast = index == timeline.count - 1
                builder.step(reasoningStep(id: entry.id, segments: matching, running: streaming && isLast))
            }
        }
    }
    return builder.rows
}

struct RunSummary: Equatable {
    let label: String
    let failed: Int
    let icons: [String]
}

/// Terse run summary: an agent counts once regardless of children; the expanded list carries the detail.
func summarizeRun(_ steps: [TimelineStep]) -> RunSummary {
    var icons: [String] = []
    var failed = 0
    for step in steps {
        if !icons.contains(step.icon) { icons.append(step.icon) }
        if step.status == .failed || hasFailedDescendant(step) { failed += 1 }
    }
    let total = steps.count
    let plural = total == 1 ? "" : "s"
    let label = steps.allSatisfy { $0.kind == .reasoning } ? "\(total) thought\(plural)" : "\(total) tool\(plural) used"
    return RunSummary(label: label, failed: failed, icons: icons)
}

/// Latest running step in a run, else nil.
func findLiveStep(in steps: [TimelineStep]) -> TimelineStep? {
    steps.last { $0.status == .running }
}

private let reasoningFallbackSubject = "Reasoning"

/// "Reading settings.ts" etc. A reasoning step reads as its headline, or "Thinking".
func liveLabel(for step: TimelineStep) -> String {
    if step.kind == .reasoning {
        return step.subject == reasoningFallbackSubject ? step.liveVerb : step.subject
    }
    return step.subject.isEmpty ? step.liveVerb : "\(step.liveVerb) \(step.subject)"
}

enum PlanStatus {
    case interactive
    case approved
    case revised
}

/// Display overrides for questions and plans: a step awaiting the user reads as
/// running ("awaiting"), a handled one carries the outcome as its verb.
func presentStandaloneStep(
    _ step: TimelineStep,
    isInteractive: Bool = false,
    planStatus: PlanStatus? = nil,
    dismissed: Bool = false
) -> TimelineStep {
    var presented = step
    switch step.kind {
    case .question:
        if isInteractive {
            presented.status = .running
        } else {
            presented.verb = dismissed ? "cancelled" : "answered"
        }
    case .plan:
        let resolved: PlanStatus = planStatus ?? (isInteractive ? .interactive : .approved)
        switch resolved {
        case .interactive: presented.status = .running
        case .approved: presented.verb = "approved"
        case .revised: presented.verb = "revised"
        }
    default:
        break
    }
    return presented
}

// MARK: - Row building

private struct BuildContext {
    let streaming: Bool
    let childrenMap: [String: [ToolCall]]
}

private struct TimelineRowBuilder {
    var rows: [TimelineRow] = []

    mutating func text(id: String, text: String) {
        if !text.isEmpty { rows.append(.text(id: "text:\(id)", text: text)) }
    }

    /// Consecutive non-standalone steps merge into one run; standalone steps get their own row.
    mutating func step(_ step: TimelineStep) {
        let id = "\(step.source.typeName):\(step.id)"
        if step.standalone {
            rows.append(.step(id: id, step: step))
            return
        }
        if let last = rows.last, case .run(let runId, var steps) = last {
            steps.append(step)
            rows[rows.count - 1] = .run(id: runId, steps: steps)
        } else {
            rows.append(.run(id: id, steps: [step]))
        }
    }

    mutating func activity(_ activity: AgentActivity, streaming: Bool) {
        for step in activitySteps(activity, streaming: streaming) {
            self.step(step)
        }
    }
}

private func hasContent(_ segment: ReasoningSegment) -> Bool {
    !(segment.headline ?? "").isEmpty || !(segment.body ?? "").isEmpty
}

private func hasFailedDescendant(_ step: TimelineStep) -> Bool {
    step.children.contains { $0.status == .failed || hasFailedDescendant($0) }
}

private func reasoningStep(id: String, segments: [ReasoningSegment], running: Bool) -> TimelineStep {
    let headline = segments.reversed().first { !($0.headline ?? "").isEmpty }?.headline ?? ""
    return TimelineStep(
        id: id,
        kind: .reasoning,
        icon: "brain",
        liveVerb: "Thinking",
        verb: "thought",
        subject: headline.isEmpty ? reasoningFallbackSubject : headline,
        status: running ? .running : .completed,
        standalone: isStandalone(.reasoning),
        source: .reasoning(segments)
    )
}

// MARK: - Activities

private func activitySteps(_ activity: AgentActivity, streaming: Bool) -> [TimelineStep] {
    switch activity {
    case .planUpdate, .goalUpdate, .unknown:
        return []
    case .commandExecution(let command):
        // `toolCalls` relabels Codex commands (cat -> Read, rg -> Grep, ls -> Glob) like the web adapter.
        return activity.toolCalls.map { tool in
            TimelineStep(
                describeTool(tool),
                id: tool.id,
                status: activityStatus(status: command.status, exitCode: command.exitCode, streaming: streaming),
                stats: computeToolStats(tool),
                source: .tool(tool)
            )
        }
    case .fileChange(let change):
        return activity.toolCalls.enumerated().map { index, tool -> TimelineStep in
            let file = index < change.files.count ? change.files[index] : nil
            var step = TimelineStep(
                describeTool(tool),
                id: tool.id,
                status: activityStatus(status: file?.status ?? change.status, exitCode: nil, streaming: streaming),
                stats: computeToolStats(tool),
                source: .tool(tool)
            )
            step.subject = file.map { getFilename($0.path) } ?? "(no file)"
            step.subjectTitle = file?.path
            return step
        }
    case .diagnostic(let diagnostic):
        var step = activityStep(activity, kind: .diagnostic, icon: "exclamationmark.triangle",
                                liveVerb: "Reporting", verb: "reported", subject: diagnostic.title, status: .completed)
        switch diagnostic.severity {
        case .info: step.severity = nil
        case .warning: step.severity = .warning
        case .error: step.severity = .error
        }
        return [step]
    case .imageView(let image):
        return [activityStep(activity, kind: .image, icon: "photo", liveVerb: "Viewing", verb: "viewed",
                             subject: getFilename(image.path), status: .completed)]
    case .imageGeneration(let image):
        // savedPath is the provider's scratch file (Codex generated_images/exec-<uuid>.png);
        // only a workspace-relative path is a meaningful subject.
        let status = image.status?.lowercased()
        let terminal = status == "completed" || status == "failed" || status == "error"
        let hasImage = !(image.imageUrl ?? "").isEmpty || !(image.result ?? "").isEmpty
        let stepStatus: TimelineStepStatus
        if streaming && !terminal && !hasImage {
            stepStatus = .running
        } else if status == "failed" || status == "error" {
            stepStatus = .failed
        } else {
            stepStatus = .completed
        }
        let path = image.relativePath ?? ""
        return [activityStep(activity, kind: .image, icon: "photo", liveVerb: "Generating", verb: "generated",
                             subject: path.isEmpty ? "image" : getFilename(path), status: stepStatus)]
    case .contextCompaction(let compaction):
        return [activityStep(activity, kind: .compaction, icon: "rectangle.compress.vertical",
                             liveVerb: "Compacting", verb: "compacted", subject: "Context",
                             status: streaming && compaction.status != "completed" ? .running : .completed)]
    case .subagentActivity(let subagent):
        let verbs: (live: String, past: String)
        switch subagent.activityKind {
        case .started: verbs = ("Starting agent", "started")
        case .interacted: verbs = ("Interacting", "interacted")
        case .interrupted: verbs = ("Interrupting", "interrupted")
        }
        return [activityStep(activity, kind: .subagentActivity, icon: "arrow.triangle.branch",
                             liveVerb: verbs.live, verb: verbs.past, subject: subagent.agentPath, status: .completed)]
    }
}

private func activityStep(
    _ activity: AgentActivity,
    kind: TimelineStepKind,
    icon: String,
    liveVerb: String,
    verb: String,
    subject: String,
    status: TimelineStepStatus
) -> TimelineStep {
    TimelineStep(
        id: activity.id,
        kind: kind,
        icon: icon,
        liveVerb: liveVerb,
        verb: verb,
        subject: subject,
        status: status,
        standalone: isStandalone(kind),
        source: .activity(activity)
    )
}

private func activityStatus(status: String?, exitCode: Int?, streaming: Bool) -> TimelineStepStatus {
    if streaming && ((status ?? "").isEmpty || status == "inProgress") { return .running }
    if let exitCode, exitCode != 0 { return .failed }
    if status == "failed" || status == "error" { return .failed }
    return .completed
}

// MARK: - Tools

private func toolStep(_ tool: ToolCall, context: BuildContext) -> TimelineStep {
    let described = describeTool(tool)
    var children: [TimelineStep] = []
    let status: TimelineStepStatus
    if described.kind == .agent {
        let directChildren = context.childrenMap[tool.id] ?? []
        children = directChildren
            .filter { !hiddenTools.contains($0.name) }
            .map { toolStep($0, context: context) }
        status = agentStatus(subAgentExecutionState(
            for: tool,
            children: directChildren,
            childrenByParentId: context.childrenMap,
            showExecutingState: context.streaming
        ))
    } else {
        status = toolStatus(tool, streaming: context.streaming)
    }
    return TimelineStep(
        described,
        id: tool.id,
        status: status,
        stats: computeToolStats(tool),
        children: children,
        source: .tool(tool)
    )
}

private func agentStatus(_ state: SubAgentExecutionState) -> TimelineStepStatus {
    switch state {
    case .pending: .pending
    case .running: .running
    case .completed: .completed
    case .failed: .failed
    }
}

private func toolStatus(_ tool: ToolCall, streaming: Bool) -> TimelineStepStatus {
    if tool.isError == true || bashFailed(tool) { return .failed }
    if tool.output == nil { return streaming ? .running : .pending }
    return .completed
}

/// Mirrors `getBashMetadata(tool)?.failed` from the web tool display helpers.
private func bashFailed(_ tool: ToolCall) -> Bool {
    guard tool.name == "Bash", let input = parsedToolInputObject(tool.input) else { return false }
    if let exitCode = input["exitCode"] as? Int { return exitCode != 0 }
    let status = (input["status"] as? String)?.lowercased() ?? ""
    return status == "failed" || status == "error"
}

private let commandSubjectMax = 50

/// Drop shell wrappers (zsh -lc, quotes) and a leading `cd <dir> &&` so the subject shows the command that matters, then truncate.
private func commandSubject(_ command: String) -> String {
    let stripped = command
        .replacingOccurrences(of: #"^(?:\S*/)?(?:zsh|bash|sh)\s+-l?c\s+"#, with: "", options: .regularExpression)
        .replacingOccurrences(of: #"^(["'])([\s\S]*)\1$"#, with: "$2", options: .regularExpression)
        .replacingOccurrences(of: #"^cd\s+\S+\s*&&\s*"#, with: "", options: .regularExpression)
        .trimmingCharacters(in: .whitespacesAndNewlines)
    return stripped.count > commandSubjectMax ? String(stripped.prefix(commandSubjectMax)) + "..." : stripped
}

private struct ToolDescription {
    let kind: TimelineStepKind
    let icon: String
    let liveVerb: String
    let verb: String
    let subject: String
    var subjectTitle: String? = nil
}

private extension TimelineStep {
    init(
        _ description: ToolDescription,
        id: String,
        status: TimelineStepStatus,
        stats: ChatActivityStats? = nil,
        children: [TimelineStep] = [],
        source: TimelineStepSource
    ) {
        self.init(
            id: id,
            kind: description.kind,
            icon: description.icon,
            liveVerb: description.liveVerb,
            verb: description.verb,
            subject: description.subject,
            subjectTitle: description.subjectTitle,
            status: status,
            stats: stats,
            standalone: isStandalone(description.kind),
            children: children,
            source: source
        )
    }
}

private func describeTool(_ tool: ToolCall) -> ToolDescription {
    let generic = ToolDescription(kind: .tool, icon: "wrench", liveVerb: "Calling", verb: "called", subject: tool.name)
    guard let input = parsedToolInputObject(tool.input) else { return generic }
    let filePath = resolveFilePath(input)
    let fileName = filePath.map(getFilename) ?? ""

    switch tool.name {
    case "Read":
        return ToolDescription(kind: .tool, icon: "doc.text", liveVerb: "Reading", verb: "read", subject: fileName, subjectTitle: filePath)
    case "Edit":
        return ToolDescription(kind: .tool, icon: "pencil", liveVerb: "Editing", verb: "edited", subject: fileName, subjectTitle: filePath)
    case "Write":
        return ToolDescription(kind: .tool, icon: "doc.text", liveVerb: "Writing", verb: "wrote", subject: fileName, subjectTitle: filePath)
    case "Bash":
        let command = input["command"] as? String
        return ToolDescription(kind: .tool, icon: "terminal", liveVerb: "Running", verb: "ran",
                               subject: command.map(commandSubject) ?? "", subjectTitle: command)
    case "Grep":
        return ToolDescription(kind: .tool, icon: "magnifyingglass", liveVerb: "Searching", verb: "searched",
                               subject: (input["pattern"] as? String) ?? "")
    case "Glob":
        let pattern = input["pattern"] as? String
        let path = input["path"] as? String
        return ToolDescription(kind: .tool, icon: "magnifyingglass", liveVerb: "Searching", verb: "searched",
                               subject: pattern ?? path ?? "")
    case "WebFetch", "WebSearch":
        let url = input["url"] as? String
        let query = input["query"] as? String
        return ToolDescription(kind: .tool, icon: "globe", liveVerb: "Fetching", verb: "fetched", subject: url ?? query ?? "")
    case "TaskCreate":
        return ToolDescription(kind: .tool, icon: "checklist", liveVerb: "Tracking", verb: "tracked",
                               subject: (input["subject"] as? String) ?? "")
    case "TaskList":
        return ToolDescription(kind: .tool, icon: "checklist", liveVerb: "Tracking", verb: "tracked", subject: "")
    case "TaskGet":
        let taskId = input["taskId"] as? String
        return ToolDescription(kind: .tool, icon: "checklist", liveVerb: "Tracking", verb: "tracked",
                               subject: taskId.map { "#\($0)" } ?? "")
    case "Task", "Agent":
        guard let info = parseSubAgentInfo(tool) else { return generic }
        return ToolDescription(
            kind: .agent,
            icon: "arrow.triangle.branch",
            liveVerb: "Delegating",
            verb: "delegated",
            subject: info.description.isEmpty ? info.subagentType : info.description,
            subjectTitle: info.description.isEmpty ? nil : info.description
        )
    case "ExitPlanMode":
        return ToolDescription(kind: .plan, icon: "doc.plaintext", liveVerb: "Awaiting", verb: "planned", subject: "Proposed plan")
    case "AskUserQuestion":
        // Mirrors `isAskUserQuestion`: the input must carry a questions array.
        guard let questions = input["questions"] as? [Any] else { return generic }
        let first = (questions.first as? [String: Any])?["question"] as? String
        return ToolDescription(kind: .question, icon: "bubble.left", liveVerb: "Awaiting", verb: "asked",
                               subject: first ?? "User input")
    default:
        return generic
    }
}

// MARK: - Plan content

/// Plan markdown for a plan step, resolved against the tools up to and including
/// the ExitPlanMode tool so a later revision never leaks in. Covers the Write flow
/// (the hidden plan Write tool) and the inline `plan` input; the Read+Edit flow
/// keeps its rows visible and resolves to nil.
func planContent(in toolCalls: [ToolCall], planToolId: String) -> String? {
    guard let index = toolCalls.firstIndex(where: { $0.id == planToolId }) else { return nil }
    let preceding = Array(toolCalls[...index])
    if let writeId = planWriteToolId(preceding),
       let write = preceding.first(where: { $0.id == writeId }),
       let content = parsedToolInputObject(write.input)?["content"] as? String {
        return content
    }
    let plan = parsedToolInputObject(toolCalls[index].input)?["plan"] as? String ?? ""
    return plan.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : plan
}

/// Minimal port of `findPlanContent` from `frontend/src/lib/plan-state.ts`: only
/// the id of the Write tool that carries the plan, so the timeline can hide it.
private func planWriteToolId(_ toolCalls: [ToolCall]) -> String? {
    func filePath(_ tool: ToolCall) -> String? {
        parsedToolInputObject(tool.input)?["file_path"] as? String
    }
    func isPlanFileTool(_ tool: ToolCall, name: String) -> Bool {
        tool.name == name && (filePath(tool)?.contains(".claude/plans/") ?? false)
    }

    // 1. Write tool targeting .claude/plans/
    if let writeTool = toolCalls.last(where: { isPlanFileTool($0, name: "Write") }) {
        return writeTool.id
    }

    // 2. Edit flow: the plan is rebuilt from a Read output, there is no Write tool to hide.
    let planPaths = Set(toolCalls.filter { isPlanFileTool($0, name: "Edit") }.compactMap(filePath))
    let hasPlanRead = toolCalls.contains { tool in
        tool.name == "Read" && !(tool.output ?? "").isEmpty && filePath(tool).map { planPaths.contains($0) } == true
    }
    if hasPlanRead { return nil }

    // 3. ExitPlanMode carrying the plan inline.
    if let exitTool = toolCalls.first(where: { $0.name == "ExitPlanMode" }),
       let plan = parsedToolInputObject(exitTool.input)?["plan"] as? String,
       !plan.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        return nil
    }

    // 4. Fallback: last Write to any .md file with content.
    if let mdWrite = toolCalls.last(where: { $0.name == "Write" && (filePath($0)?.hasSuffix(".md") ?? false) }),
       let content = parsedToolInputObject(mdWrite.input)?["content"] as? String,
       !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        return mdWrite.id
    }
    return nil
}
