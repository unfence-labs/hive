import Foundation
import Testing
@testable import HiveMobileStoresCore

/// Port of `frontend/tests/lib/timeline-steps.test.ts`.
struct TimelineStepsTests {
    // MARK: buildTimelineRows

    @Test
    func mapsClaudeTurnIntoTextRunsStandaloneStepsAndAgentChildren() throws {
        let msg = message(
            toolCalls: [
                tool("read", name: "Read", input: #"{"file_path":"/repo/src/settings.ts"}"#),
                tool("edit", name: "Edit", input: #"{"file_path":"/repo/src/settings.ts","old_string":"a","new_string":"b\nc"}"#),
                tool("bash", name: "Bash", input: #"{"command":"npm test -- --run --reporter=verbose tests/lib/timeline-steps.test.ts","exitCode":1}"#),
                tool("grep", name: "Grep", input: #"{"pattern":"buildTimelineRows","path":"/repo/src"}"#, output: "a\nb"),
                tool("todo", name: "TodoList", input: #"{"items":[]}"#),
                tool("agent", name: "Task", input: #"{"subagent_type":"Explore","description":"find callers"}"#, output: nil),
                tool("child-read", name: "Read", input: #"{"file_path":"/repo/b.ts"}"#, parent: "agent"),
                tool("child-update", name: "TaskUpdate", input: "{}", parent: "agent"),
                tool("question", name: "AskUserQuestion", input: #"{"questions":[{"question":"Which one?","options":[]}]}"#, output: nil)
            ],
            segments: [ReasoningSegment(id: "r1:0", headline: "Plan the edit", body: "...")],
            timeline: [
                .init(type: .reasoning, id: "r1"),
                .init(type: .text, id: "t1", text: "Let me look."),
                .init(type: .tool, id: "read"),
                .init(type: .tool, id: "edit"),
                .init(type: .tool, id: "bash"),
                .init(type: .tool, id: "grep"),
                .init(type: .tool, id: "todo"),
                .init(type: .tool, id: "missing"),
                .init(type: .text, id: "t2", text: ""),
                .init(type: .tool, id: "agent"),
                .init(type: .tool, id: "question"),
                .init(type: .text, id: "t3", text: "Done.")
            ]
        )

        let rows = buildTimelineRows(message: msg, streaming: true)
        #expect(rowTypes(rows) == ["run", "text", "run", "step", "text"])

        let reasoning = try #require(runSteps(rows, 0).first)
        #expect(reasoning.kind == .reasoning)
        #expect(reasoning.icon == "brain")
        #expect(reasoning.verb == "thought")
        #expect(reasoning.subject == "Plan the edit")
        #expect(reasoning.status == .completed)
        #expect(reasoning.standalone == false)
        #expect(reasoning.source == .reasoning([ReasoningSegment(id: "r1:0", headline: "Plan the edit", body: "...")]))

        let steps = runSteps(rows, 2)
        try #require(steps.count == 5)
        #expect(steps.map(\.id) == ["read", "edit", "bash", "grep", "agent"])
        #expect(steps.map(\.verb) == ["read", "edited", "ran", "searched", "delegated"])
        #expect(steps.map(\.subject) == [
            "settings.ts",
            "settings.ts",
            "npm test -- --run --reporter=verbose tests/lib/tim...",
            "buildTimelineRows",
            "find callers"
        ])
        #expect(steps.map(\.status) == [.completed, .completed, .failed, .completed, .running])
        #expect(steps[0].subjectTitle == "/repo/src/settings.ts")
        #expect(steps[1].stats == ChatActivityStats(kind: .diff, added: 2, removed: 1))
        #expect(steps[2].subjectTitle == "npm test -- --run --reporter=verbose tests/lib/timeline-steps.test.ts")
        #expect(steps[3].stats == ChatActivityStats(kind: .plain, label: "2 results"))

        let agent = steps[4]
        #expect(agent.kind == .agent)
        #expect(agent.icon == "arrow.triangle.branch")
        #expect(agent.subjectTitle == "find callers")
        #expect(agent.standalone == false)
        #expect(agent.children.map(\.id) == ["child-read"])
        #expect(agent.children.map(\.verb) == ["read"])
        #expect(agent.children.map(\.subject) == ["b.ts"])

        let question = try #require(singleStep(rows, 3))
        #expect(question.kind == .question)
        #expect(question.icon == "bubble.left")
        #expect(question.liveVerb == "Awaiting")
        #expect(question.verb == "asked")
        #expect(question.subject == "Which one?")
        #expect(question.status == .running)
        #expect(question.standalone == true)
    }

    @Test
    func trailingReasoningRunsWhileStreamingAndToolsArePendingWhenIdle() throws {
        let msg = message(
            toolCalls: [tool("read", name: "Read", input: #"{"file_path":"a.ts"}"#, output: nil)],
            segments: [ReasoningSegment(id: "r1:0", headline: nil, body: "thinking")],
            timeline: [.init(type: .tool, id: "read"), .init(type: .reasoning, id: "r1")]
        )
        let live = runSteps(buildTimelineRows(message: msg, streaming: true), 0)
        try #require(live.count == 2)
        #expect(live.map(\.status) == [.running, .running])
        #expect(live[1].kind == .reasoning)
        #expect(live[1].subject == "Reasoning")

        let idle = runSteps(buildTimelineRows(message: msg, streaming: false), 0)
        #expect(idle.map(\.status) == [.pending, .completed])
    }

    @Test
    func hidesPlanWriteToolAndMapsExitPlanModeToStandalonePlanStep() throws {
        let msg = message(
            toolCalls: [
                tool("write", name: "Write", input: ##"{"file_path":"/repo/.claude/plans/plan.md","content":"# Plan"}"##),
                tool("exit", name: "ExitPlanMode", input: "{}")
            ],
            timeline: [.init(type: .tool, id: "write"), .init(type: .tool, id: "exit")]
        )
        let rows = buildTimelineRows(message: msg, streaming: false)
        #expect(rows.count == 1)
        let plan = try #require(singleStep(rows, 0))
        #expect(plan.kind == .plan)
        #expect(plan.icon == "doc.plaintext")
        #expect(plan.liveVerb == "Awaiting")
        #expect(plan.verb == "planned")
        #expect(plan.subject == "Proposed plan")
    }

    @Test
    func mapsCodexActivitiesToStepsWithSameVerbsAsClaudeTools() throws {
        let msg = message(
            activities: [
                .commandExecution(.init(
                    id: "cmd-read", command: "cat src/app.ts", cwd: nil, status: "completed",
                    output: nil, exitCode: nil, durationMs: nil,
                    commandActions: [AgentActivityCommandAction(type: "read", command: "cat src/app.ts", name: nil, path: "src/app.ts", query: nil)]
                )),
                .commandExecution(.init(id: "cmd-run", command: "npm test", cwd: nil, status: "inProgress",
                                        output: nil, exitCode: nil, durationMs: nil)),
                .fileChange(.init(id: "change", status: "completed", files: [
                    AgentActivityFile(path: "src/a.ts", diff: "--- a\n+++ b\n+one\n+two\n-three", kind: nil, status: nil),
                    AgentActivityFile(path: "src/b.ts", diff: "", kind: nil, status: "failed")
                ])),
                .fileChange(.init(id: "empty-change", status: "completed", files: [])),
                .diagnostic(.init(id: "diag", severity: .warning, title: "Rate limited", message: "slow down",
                                  source: nil, method: nil, details: nil)),
                .planUpdate(.init(id: "plan", steps: [])),
                .contextCompaction(.init(id: "compact", status: "inProgress")),
                .subagentActivity(.init(id: "sub", activityKind: .started, agentThreadId: "t", agentPath: "root/worker")),
                .imageGeneration(.init(id: "img", status: "inProgress", revisedPrompt: nil, result: nil,
                                       savedPath: nil, relativePath: nil, imageUrl: nil))
            ],
            timeline: ["cmd-read", "cmd-run", "change", "empty-change", "diag", "plan", "compact", "sub", "img"]
                .map { ConversationTimelineEntry(type: .activity, id: $0) }
        )

        let rows = buildTimelineRows(message: msg, streaming: true)
        #expect(rowTypes(rows) == ["run", "step", "run"])

        let steps = runSteps(rows, 0)
        try #require(steps.count == 5)
        #expect(steps.map(\.id) == ["cmd-read", "cmd-run", "change:0:src/a.ts", "change:1:src/b.ts", "empty-change"])
        #expect(steps.map(\.verb) == ["read", "ran", "edited", "edited", "edited"])
        #expect(steps.map(\.subject) == ["app.ts", "npm test", "a.ts", "b.ts", "(no file)"])
        #expect(steps.map(\.status) == [.completed, .running, .completed, .failed, .completed])
        if case .tool(let converted) = steps[0].source {
            #expect(converted.name == "Read")
        } else {
            Issue.record("Expected a tool source for the converted command")
        }
        #expect(steps[2].stats == ChatActivityStats(kind: .diff, added: 2, removed: 1))
        #expect(steps[2].subjectTitle == "src/a.ts")

        let diagnostic = try #require(singleStep(rows, 1))
        #expect(diagnostic.kind == .diagnostic)
        #expect(diagnostic.icon == "exclamationmark.triangle")
        #expect(diagnostic.verb == "reported")
        #expect(diagnostic.subject == "Rate limited")
        #expect(diagnostic.severity == .warning)
        #expect(diagnostic.standalone == true)

        let tail = runSteps(rows, 2)
        try #require(tail.count == 3)
        #expect(tail[0].kind == .compaction)
        #expect(tail[0].icon == "rectangle.compress.vertical")
        #expect(tail[0].liveVerb == "Compacting")
        #expect(tail[0].verb == "compacted")
        #expect(tail[0].subject == "Context")
        #expect(tail[0].status == .running)
        #expect(tail[0].standalone == false)
        #expect(tail[1].kind == .subagentActivity)
        #expect(tail[1].icon == "arrow.triangle.branch")
        #expect(tail[1].liveVerb == "Starting agent")
        #expect(tail[1].verb == "started")
        #expect(tail[1].subject == "root/worker")
        #expect(tail[1].standalone == false)
        #expect(tail[2].kind == .image)
        #expect(tail[2].verb == "generated")
        #expect(tail[2].subject == "image")
        #expect(tail[2].status == .running)
        #expect(tail[2].standalone == false)

        let idle = buildTimelineRows(message: msg, streaming: false)
        #expect(runSteps(idle, 0).map(\.status)[1] == .completed)
        #expect(runSteps(idle, 2).map(\.status) == [.completed, .completed, .completed])
    }

    @Test
    func synthesizesReasoningTextToolsThenActivitiesForLegacyMessages() throws {
        let msg = message(
            content: "Legacy answer",
            toolCalls: [
                tool("todo", name: "TodoList", input: #"{"items":[]}"#),
                tool("read", name: "Read", input: #"{"file_path":"a.ts"}"#)
            ],
            activities: [
                .imageView(.init(id: "view", path: "/repo/shot.png", relativePath: nil, imageUrl: nil, outsideWorkspace: nil)),
                .commandExecution(.init(id: "cmd", command: "ls", cwd: nil, status: "completed",
                                        output: nil, exitCode: nil, durationMs: nil))
            ],
            segments: [
                ReasoningSegment(id: "a", headline: "First", body: nil),
                ReasoningSegment(id: "b", headline: "Second", body: nil)
            ]
        )

        let rows = buildTimelineRows(message: msg, streaming: false)
        try #require(rowTypes(rows) == ["run", "text", "run"])
        let reasoning = try #require(runSteps(rows, 0).first)
        #expect(reasoning.id == "reasoning")
        #expect(reasoning.subject == "Second")
        #expect(rows[1] == .text(id: "text:msg-1", text: "Legacy answer"))
        let actions = runSteps(rows, 2)
        try #require(actions.count == 3)
        #expect(actions.map(\.id) == ["read", "view", "cmd"])
        #expect(actions[1].kind == .image)
        #expect(actions[1].verb == "viewed")
        #expect(actions[1].subject == "shot.png")
    }

    @Test
    func leavesInfoDiagnosticsWithoutSeverityMark() throws {
        let rows = buildTimelineRows(message: message(activities: [
            .diagnostic(.init(id: "diag", severity: .info, title: "Note", message: "fyi", source: nil, method: nil, details: nil))
        ]), streaming: false)
        let diagnostic = try #require(singleStep(rows, 0))
        #expect(diagnostic.severity == nil)
    }

    @Test
    func skipsLegacyReasoningStepWhenSegmentsCarryNoContent() {
        let rows = buildTimelineRows(
            message: message(content: "Hi", segments: [ReasoningSegment(id: "a", headline: nil, body: nil)]),
            streaming: false
        )
        #expect(rows == [.text(id: "text:msg-1", text: "Hi")])
    }

    // MARK: describeTool

    @Test
    func mapsWebTaskTrackingMcpAndUnknownToolsToIconVerbAndSubject() throws {
        let fetch = try #require(describe(tool("fetch", name: "WebFetch", input: #"{"url":"https://hive.dev","prompt":"summarize"}"#)))
        #expect(fetch.icon == "globe")
        #expect(fetch.verb == "fetched")
        #expect(fetch.subject == "https://hive.dev")

        let search = try #require(describe(tool("search", name: "WebSearch", input: #"{"query":"vitest mocks"}"#)))
        #expect(search.icon == "globe")
        #expect(search.verb == "fetched")
        #expect(search.subject == "vitest mocks")

        let create = try #require(describe(tool("create", name: "TaskCreate", input: #"{"subject":"Fix login bug","description":"Auth fails"}"#)))
        #expect(create.icon == "checklist")
        #expect(create.verb == "tracked")
        #expect(create.subject == "Fix login bug")

        let get = try #require(describe(tool("get", name: "TaskGet", input: #"{"taskId":"9"}"#)))
        #expect(get.verb == "tracked")
        #expect(get.subject == "#9")

        let getNone = try #require(describe(tool("get-none", name: "TaskGet", input: "{}")))
        #expect(getNone.verb == "tracked")
        #expect(getNone.subject == "")

        let mcp = try #require(describe(tool("mcp", name: "mcp__github__create_issue", input: #"{"title":"x"}"#)))
        #expect(mcp.icon == "wrench")
        #expect(mcp.liveVerb == "Calling")
        #expect(mcp.verb == "called")
        #expect(mcp.subject == "mcp__github__create_issue")
    }

    @Test
    func fallsBackToGenericCalledStepWhenInputIsNotJsonIncludingForTask() throws {
        let bash = try #require(describe(tool("bad-bash", name: "Bash", input: "{not-json", output: "result")))
        #expect(bash.kind == .tool)
        #expect(bash.icon == "wrench")
        #expect(bash.verb == "called")
        #expect(bash.subject == "Bash")

        let task = try #require(describe(tool("bad-task", name: "Task", input: "not json at all", output: "x")))
        #expect(task.kind == .tool)
        #expect(task.icon == "wrench")
        #expect(task.subject == "Task")
        #expect(task.children.isEmpty)
    }

    @Test
    func usesAgentTypeAloneAsSubjectWhenDescriptionIsEmpty() throws {
        let agent = try #require(describe(tool("agent", name: "Task", input: #"{"subagent_type":"Explore","description":""}"#)))
        #expect(agent.kind == .agent)
        #expect(agent.subject == "Explore")
        #expect(agent.subjectTitle == nil)
    }

    @Test
    func dropsTopLevelTaskUpdateAndTodoListToolsAndChildrenOfNonAgentTools() {
        let msg = message(
            toolCalls: [
                tool("read", name: "Read", input: #"{"file_path":"/a"}"#),
                tool("update", name: "TaskUpdate", input: #"{"taskId":"1","status":"completed"}"#),
                tool("todo", name: "TodoList", input: #"{"items":[]}"#),
                tool("orphan", name: "Read", input: #"{"file_path":"/b"}"#, parent: "read")
            ],
            timeline: ["read", "update", "todo", "orphan"].map { ConversationTimelineEntry(type: .tool, id: $0) }
        )
        let rows = buildTimelineRows(message: msg, streaming: false)
        #expect(rows.count == 1)
        #expect(runSteps(rows, 0).map(\.id) == ["read"])
    }

    @Test
    func mapsEveryCodexSubagentActivityKindToItsVerb() throws {
        let expected: [AgentActivitySubagentActivityKind: (liveVerb: String, verb: String)] = [
            .started: ("Starting agent", "started"),
            .interacted: ("Interacting", "interacted"),
            .interrupted: ("Interrupting", "interrupted")
        ]
        for kind in AgentActivitySubagentActivityKind.allCases {
            let msg = message(
                activities: [.subagentActivity(.init(id: "sub", activityKind: kind, agentThreadId: "t", agentPath: "root/worker"))],
                timeline: [.init(type: .activity, id: "sub")]
            )
            let step = try #require(runSteps(buildTimelineRows(message: msg, streaming: true), 0).first)
            let verbs = try #require(expected[kind])
            #expect(step.kind == .subagentActivity)
            #expect(step.icon == "arrow.triangle.branch")
            #expect(step.liveVerb == verbs.liveVerb)
            #expect(step.verb == verbs.verb)
            #expect(step.subject == "root/worker")
            #expect(step.status == .completed)
        }
    }

    // MARK: Agent status from raw collaboration state

    @Test
    func collaborationOutputDoesNotFinishAnAgentWhoseRawStateIsStillRunning() throws {
        let msg = message(
            toolCalls: [ToolCall(
                id: "agent", name: "Agent",
                input: #"{"tool":"spawnAgent","agentsStates":{"child":{"status":"running"}}}"#,
                output: "Spawned", parentToolUseId: nil
            )],
            timeline: [.init(type: .tool, id: "agent")]
        )
        let live = runSteps(buildTimelineRows(message: msg, streaming: true), 0)
        let agent = try #require(live.first)
        #expect(agent.kind == .agent)
        #expect(agent.status == .running)
        #expect(findLiveStep(in: live)?.id == "agent")
        #expect(summarizeRun(live).failed == 0)
        // Outside a live turn the persisted record reads as finished.
        #expect(runSteps(buildTimelineRows(message: msg, streaming: false), 0).first?.status == .completed)
    }

    @Test
    func agentRawFailureAndExplicitErrorsReadAsFailedSteps() throws {
        let msg = message(
            toolCalls: [
                ToolCall(id: "raw", name: "Agent", input: "{}",
                         output: #"{"agentsStates":{"child":{"status":"errored"}}}"#, parentToolUseId: nil),
                ToolCall(id: "explicit", name: "Agent", input: "{}", output: "Failed",
                         parentToolUseId: nil, isError: true),
                ToolCall(id: "bash", name: "Bash", input: "{}", output: "bad", parentToolUseId: nil, isError: true)
            ],
            timeline: ["raw", "explicit", "bash"].map { ConversationTimelineEntry(type: .tool, id: $0) }
        )
        let steps = runSteps(buildTimelineRows(message: msg, streaming: true), 0)
        try #require(steps.count == 3)
        #expect(steps.map(\.status) == [.failed, .failed, .failed])
        #expect(findLiveStep(in: steps) == nil)
        #expect(summarizeRun(steps).failed == 3)
    }

    @Test
    func runSummaryCountsAChildFailureAgainstItsAgent() throws {
        let msg = message(
            toolCalls: [
                tool("parent", name: "Agent", input: "{}", output: nil),
                ToolCall(id: "child", name: "Bash", input: "{}", output: "failed", parentToolUseId: "parent", isError: true)
            ],
            timeline: [.init(type: .tool, id: "parent"), .init(type: .tool, id: "child")]
        )
        let steps = runSteps(buildTimelineRows(message: msg, streaming: false), 0)
        try #require(steps.count == 1)
        #expect(steps[0].children.map(\.status) == [.failed])
        #expect(summarizeRun(steps) == RunSummary(label: "1 tool used", failed: 1, icons: ["arrow.triangle.branch"]))
    }

    // MARK: summarizeRun

    @Test
    func countsStepsOnceEachAgentsIncludedAndFailuresIncludingAgentDescendants() {
        let steps = [
            step(id: "1", verb: "read", icon: "doc.text"),
            step(id: "2", verb: "read", icon: "doc.text"),
            step(id: "3", verb: "edited", icon: "pencil", status: .failed),
            step(id: "4", verb: "ran", icon: "terminal"),
            step(id: "5", verb: "searched", icon: "magnifyingglass"),
            step(id: "6", kind: .agent, verb: "delegated", icon: "arrow.triangle.branch",
                 children: [step(id: "6a", status: .failed)])
        ]
        #expect(summarizeRun(steps) == RunSummary(
            label: "6 tools used",
            failed: 2,
            icons: ["doc.text", "pencil", "terminal", "magnifyingglass", "arrow.triangle.branch"]
        ))
    }

    @Test
    func labelsReasoningOnlyRunAsThoughts() {
        let thoughts = (1...3).map { step(id: String($0), kind: .reasoning, verb: "thought", icon: "brain") }
        #expect(summarizeRun(thoughts).label == "3 thoughts")
        #expect(summarizeRun([thoughts[0], step(id: "x")]).label == "2 tools used")
    }

    // MARK: findLiveStep and liveLabel

    @Test
    func returnsLastRunningStepAndItsLabel() throws {
        let steps = [
            step(id: "1", liveVerb: "Reading", subject: "a.ts", status: .running),
            step(id: "2", status: .completed),
            step(id: "3", liveVerb: "Running", subject: "npm test", status: .running),
            step(id: "4", status: .pending)
        ]
        let live = try #require(findLiveStep(in: steps))
        #expect(live.id == "3")
        #expect(liveLabel(for: live) == "Running npm test")
        #expect(liveLabel(for: step(liveVerb: "Thinking", subject: "")) == "Thinking")
        #expect(findLiveStep(in: [step(status: .completed)]) == nil)
    }

    // MARK: presentStandaloneStep

    private var question: TimelineStep {
        step(kind: .question, liveVerb: "Awaiting", verb: "asked", status: .completed, standalone: true)
    }

    private var plan: TimelineStep {
        step(kind: .plan, liveVerb: "Awaiting", verb: "planned", status: .pending, standalone: true)
    }

    @Test
    func marksInteractiveQuestionAsRunningAndHandledOneWithItsOutcome() {
        let interactive = presentStandaloneStep(question, isInteractive: true)
        #expect(interactive.status == .running)
        #expect(interactive.verb == "asked")
        let answered = presentStandaloneStep(question)
        #expect(answered.status == .completed)
        #expect(answered.verb == "answered")
        #expect(presentStandaloneStep(question, dismissed: true).verb == "cancelled")
    }

    @Test
    func derivesPlanStateFromPlanStatusFallingBackToInteractiveFlag() {
        let interactive = presentStandaloneStep(plan, isInteractive: true)
        #expect(interactive.status == .running)
        #expect(interactive.verb == "planned")
        let approved = presentStandaloneStep(plan, isInteractive: true, planStatus: .approved)
        #expect(approved.status == .pending)
        #expect(approved.verb == "approved")
        #expect(presentStandaloneStep(plan, planStatus: .revised).verb == "revised")
        #expect(presentStandaloneStep(plan).verb == "approved")
    }

    @Test
    func passesEveryOtherStepThroughUntouched() {
        let reasoning = step(kind: .reasoning, standalone: true)
        #expect(presentStandaloneStep(reasoning, isInteractive: true, dismissed: true) == reasoning)
    }

    // MARK: Fixtures

    private func message(
        content: String = "",
        toolCalls: [ToolCall]? = nil,
        activities: [AgentActivity]? = nil,
        segments: [ReasoningSegment]? = nil,
        timeline: [ConversationTimelineEntry]? = nil
    ) -> ChatMessage {
        ChatMessage(
            id: "msg-1", sessionId: "session-1", role: .assistant, content: content, images: nil,
            toolCalls: toolCalls, agentActivities: activities, reasoningSegments: segments, timeline: timeline,
            timestamp: "2026-01-01T00:00:00.000Z", cancelled: nil, durationMs: nil
        )
    }

    private func tool(_ id: String, name: String, input: String, output: String? = "ok", parent: String? = nil) -> ToolCall {
        ToolCall(id: id, name: name, input: input, output: output, parentToolUseId: parent)
    }

    private func step(
        id: String = "step",
        kind: TimelineStepKind = .tool,
        liveVerb: String = "Reading",
        verb: String = "read",
        icon: String = "doc.text",
        subject: String = "a.ts",
        status: TimelineStepStatus = .completed,
        standalone: Bool = false,
        children: [TimelineStep] = []
    ) -> TimelineStep {
        TimelineStep(
            id: id, kind: kind, icon: icon, liveVerb: liveVerb, verb: verb, subject: subject, status: status,
            standalone: standalone, children: children, source: .tool(tool("tool-Read", name: "Read", input: "{}"))
        )
    }

    private func rowTypes(_ rows: [TimelineRow]) -> [String] {
        rows.map { row -> String in
            switch row {
            case .text: "text"
            case .run: "run"
            case .step: "step"
            }
        }
    }

    private func runSteps(_ rows: [TimelineRow], _ index: Int) -> [TimelineStep] {
        guard index < rows.count, case .run(_, let steps) = rows[index] else {
            Issue.record("Expected run row at \(index)")
            return []
        }
        return steps
    }

    private func singleStep(_ rows: [TimelineRow], _ index: Int) -> TimelineStep? {
        guard index < rows.count, case .step(_, let step) = rows[index] else { return nil }
        return step
    }

    /// First step of a single-tool timeline, whether it lands in a run or stands alone.
    private func describe(_ tool: ToolCall) -> TimelineStep? {
        let rows = buildTimelineRows(
            message: message(toolCalls: [tool], timeline: [.init(type: .tool, id: tool.id)]),
            streaming: false
        )
        switch rows.first {
        case .run(_, let steps)?: return steps.first
        case .step(_, let step)?: return step
        default: return nil
        }
    }
}
