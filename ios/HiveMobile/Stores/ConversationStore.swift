import Foundation
import Observation

// MARK: - Per-session streaming state

struct SessionStreamState {
    var currentText = ""
    var currentThinking = ""
    var activeToolCalls: [ToolCall] = []
    var activeAgentActivities: [AgentActivity] = []
    var isStreaming = false
    var streamingStartedAt: Date?
    var pendingToolInputs: [PendingToolInput] = []
    var agentPlanMode: Bool?
}

@MainActor
@Observable
final class ConversationStore {
    private static let outgoingTimestampFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    /// ISO8601 timestamp for the current moment (shared formatter).
    static func timestamp() -> String {
        outgoingTimestampFormatter.string(from: Date())
    }

    // MARK: - Public state

    /// Send closure wired by HubStatusMonitor to the workspace's WS connection.
    /// Returns `true` if the message was handed to the WebSocket, `false` otherwise.
    var send: ((WsIncoming) async -> Bool)?

    var messages: [ChatMessage] = []

    /// Session currently displayed in chat.
    var sessionId: String?

    /// Monotonically increasing tokens keyed by session ID.
    /// Used to discard stale REST history fetches on a per-session basis.
    private var historyTokenBySession: [String: Int] = [:]

    /// Called when a turn finishes (done/cancelled) with the session ID.
    /// ChatView wires this to re-fetch messages from REST so client-generated
    /// UUIDs are replaced with backend-assigned IDs.
    var onTurnCompleted: ((String) -> Void)?

    /// Per-session transient streaming state. Keyed by session ID.
    var sessionStreams: [String: SessionStreamState] = [:]

    // Branch & diff info (pushed via WS)
    var branchInfo: BranchInfo?
    var diffStats: DiffStatResponse?

    /// Provider locked for this session (pushed via WS status events).
    var lockedProvider: String?

    // MARK: - Computed

    /// The active session's stream state (convenience accessor).
    var activeStream: SessionStreamState? {
        sessionId.flatMap { sessionStreams[$0] }
    }

    /// Whether the active session's agent entered plan mode on its own (via EnterPlanMode).
    var agentPlanMode: Bool? { activeStream?.agentPlanMode }

    /// Busy state for the currently focused session only.
    var isBusy: Bool { activeStream?.isStreaming ?? false }
    var isStreaming: Bool { activeStream?.isStreaming ?? false }
    var streamingStartedAt: Date? { activeStream?.streamingStartedAt }
    var currentText: String { activeStream?.currentText ?? "" }
    var currentThinking: String { activeStream?.currentThinking ?? "" }
    var activeToolCalls: [ToolCall] { activeStream?.activeToolCalls ?? [] }
    var activeAgentActivities: [AgentActivity] { activeStream?.activeAgentActivities ?? [] }
    var pendingToolInputs: [PendingToolInput] { activeStream?.pendingToolInputs ?? [] }

    /// Derived task tracking state from task tools and Codex plan updates.
    var tasksState: TasksState {
        deriveTasks(
            from: messages,
            activeToolCalls: activeStream?.activeToolCalls ?? [],
            activeAgentActivities: activeStream?.activeAgentActivities ?? []
        )
    }

    /// Active Codex goal, if any (mirrors `useGoalState`).
    var goalState: GoalState? {
        deriveGoalState(
            from: messages,
            activeAgentActivities: activeStream?.activeAgentActivities ?? []
        )
    }

    /// Background sub-agents and their running state (mirrors `useBackgroundAgents`).
    var backgroundAgents: BackgroundAgentsState {
        deriveBackgroundAgents(
            from: messages,
            activeToolCalls: activeStream?.activeToolCalls ?? []
        )
    }

    // MARK: - Event handling

    func handle(_ event: WsOutgoing) {
        switch event {
        case .textDelta(let sid, let text):
            guard sessionStreams[sid] != nil else { return }
            sessionStreams[sid]?.currentText += text

        case .thinking(let sid, let text):
            guard sessionStreams[sid] != nil else { return }
            sessionStreams[sid]?.currentThinking += text

        case .toolUse(let sid, let id, let name, let input, let parentToolUseId):
            guard sessionStreams[sid] != nil else { return }
            sessionStreams[sid]?.activeToolCalls.append(ToolCall(
                id: id, name: name, input: input,
                output: nil, parentToolUseId: parentToolUseId
            ))

        case .toolResult(let sid, let toolUseId, let output):
            guard let stream = sessionStreams[sid],
                  let idx = stream.activeToolCalls.firstIndex(where: { $0.id == toolUseId }) else { return }
            let tc = stream.activeToolCalls[idx]
            sessionStreams[sid]?.activeToolCalls[idx] = ToolCall(
                id: tc.id, name: tc.name, input: tc.input,
                output: output, parentToolUseId: tc.parentToolUseId
            )

        case .agentActivity(let sid, let activity):
            upsertAgentActivity(activity, for: sid)

        case .streamSnapshot(let sid, let text, let thinking, let toolCalls,
                             let agentActivities, let agentPlanMode, let startedAt):
            var stream = sessionStreams[sid] ?? SessionStreamState()
            stream.currentText = text
            stream.currentThinking = thinking
            stream.activeToolCalls = toolCalls
            stream.activeAgentActivities = agentActivities
            stream.isStreaming = true
            stream.streamingStartedAt = startedAt.map(parseStartedAt) ?? stream.streamingStartedAt ?? Date()
            stream.pendingToolInputs = []
            stream.agentPlanMode = agentPlanMode
            sessionStreams[sid] = stream
            if sessionId == nil {
                sessionId = sid
            }

        case .toolInputRequired(let sid, let requestId, let toolName, let toolUseId, let input):
            if sessionStreams[sid] == nil && hasTerminalAssistantMessage(for: sid) {
                return
            }
            ensureStream(for: sid, streaming: false)
            sessionStreams[sid]?.pendingToolInputs.append(PendingToolInput(
                sessionId: sid, requestId: requestId,
                toolName: toolName, toolUseId: toolUseId, input: input
            ))

        case .toolInputResolved(let sid):
            // A client (possibly another device) answered or dismissed the question.
            sessionStreams[sid]?.pendingToolInputs = []

        case .done(let sid, let durationMs, let inputTokens, let outputTokens,
                   let contextUsedTokens, let contextWindowTokens, _):
            finalizeMessage(sessionId: sid, durationMs: durationMs, cancelled: false,
                            inputTokens: inputTokens, outputTokens: outputTokens,
                            contextUsedTokens: contextUsedTokens,
                            contextWindowTokens: contextWindowTokens)
            onTurnCompleted?(sid)

        case .cancelled(let sid, let errorDetail, _, let durationMs):
            finalizeMessage(sessionId: sid, durationMs: durationMs, cancelled: true, errorDetail: errorDetail)
            onTurnCompleted?(sid)

        case .error(let message, let errorSessionId):
            if let errorSessionId, let currentSessionId = sessionId, errorSessionId != currentSessionId {
                return
            }
            messages.append(ChatMessage(
                id: UUID().uuidString, sessionId: "", role: .assistant,
                content: "Error: \(message)", images: nil, toolCalls: nil,
                agentActivities: nil,
                thinkingContent: nil, timestamp: Self.outgoingTimestampFormatter.string(from: Date()),
                cancelled: nil, durationMs: nil
            ))

        case .status(let status, let incomingSessionId, let streaming, let startedAt, let provider):
            let newIsStreaming = streaming ?? (status == .idle ? false : nil)

            if let sid = incomingSessionId, let newIsStreaming {
                if newIsStreaming {
                    ensureStream(for: sid)
                    if var stream = sessionStreams[sid] {
                        stream.isStreaming = true
                        // A (re)starting turn means any pending question was
                        // answered, possibly on another client (e.g. web).
                        stream.pendingToolInputs = []
                        // Prefer backend start time so iOS/web timers stay aligned.
                        if let startedAt {
                            stream.streamingStartedAt = parseStartedAt(startedAt)
                        } else if stream.streamingStartedAt == nil {
                            stream.streamingStartedAt = Date()
                        }
                        sessionStreams[sid] = stream
                    }
                } else if var stream = sessionStreams[sid] {
                    // Session stopped streaming. Clean up if no content.
                    if stream.currentText.isEmpty && stream.currentThinking.isEmpty
                        && stream.activeToolCalls.isEmpty && stream.activeAgentActivities.isEmpty
                        && stream.pendingToolInputs.isEmpty {
                        sessionStreams.removeValue(forKey: sid)
                    } else {
                        stream.isStreaming = false
                        stream.streamingStartedAt = nil
                        sessionStreams[sid] = stream
                    }
                }
            }

            // Only update lockedProvider for the active session
            if let provider, incomingSessionId == sessionId {
                lockedProvider = provider
            }

            // Only adopt sessionId from status if we don't have one yet
            if sessionId == nil, let incomingSessionId {
                sessionId = incomingSessionId
            }

        case .userMessage(let msg):
            let sid = msg.sessionId
            let isActive = sessionId == nil || sid == sessionId
            let alreadyExists = messages.contains { $0.id == msg.id }
            if isActive && !alreadyExists {
                messages.append(msg)
            }
            sessionId = sessionId ?? sid
            ensureStream(for: sid)
            sessionStreams[sid]?.currentText = ""
            sessionStreams[sid]?.currentThinking = ""
            sessionStreams[sid]?.activeToolCalls = []
            sessionStreams[sid]?.activeAgentActivities = []
            sessionStreams[sid]?.pendingToolInputs = []

        case .history(let msgs, let incomingSessionId):
            let historySessionId = incomingSessionId ?? msgs.first?.sessionId ?? sessionId
            // Only update messages for the active session
            guard historySessionId == nil || sessionId == nil || historySessionId == sessionId else { return }

            // Always apply history — it contains finalized turns only.
            // Streaming content lives in sessionStreams and is rendered as a
            // separate in-progress bubble by the chat view.
            messages = msgs
            bumpHistoryToken(for: historySessionId)
            sessionId = historySessionId ?? sessionId

            // Derive pending tool inputs from history only when not actively
            // streaming (during streaming, live WS tool inputs take precedence).
            let activeStream = historySessionId.flatMap { sessionStreams[$0] }
            if activeStream?.isStreaming != true {
                let derived = derivePendingToolInputsFromHistory(msgs)
                if let sid = historySessionId {
                    if activeStream != nil || !derived.isEmpty {
                        ensureStream(for: sid, streaming: false)
                        sessionStreams[sid]?.pendingToolInputs = derived
                    }
                }
            }

        case .branchInfo(let info):
            branchInfo = info

        case .diffStats(let stats):
            diffStats = stats

        case .scriptStatus:
            break // Handled by sidebar, not relevant to chat

        case .planModeChanged(let sid, let active):
            guard sessionStreams[sid] != nil else { return }
            sessionStreams[sid]?.agentPlanMode = active

        case .unknown:
            break
        }
    }

    func clearPendingToolInputs() {
        guard let sid = sessionId else { return }
        sessionStreams[sid]?.pendingToolInputs = []
    }

    /// Set plan-mode state for a specific session.
    func setAgentPlanMode(_ active: Bool?, for sessionId: String?) {
        guard let sessionId else { return }
        ensureStream(for: sessionId, streaming: false)
        sessionStreams[sessionId]?.agentPlanMode = active
    }

    /// Current history token for a given session.
    func historyToken(for sessionId: String?) -> Int {
        guard let sessionId else { return 0 }
        return historyTokenBySession[sessionId] ?? 0
    }

    /// Begin a new REST history request for a session.
    /// Returns the request token that must still match when applying results.
    @discardableResult
    func beginHistoryRequest(for sessionId: String?) -> Int {
        guard let sessionId else { return 0 }
        let next = (historyTokenBySession[sessionId] ?? 0) + 1
        historyTokenBySession[sessionId] = next
        return next
    }

    /// Invalidate in-flight REST history requests for a session.
    func bumpHistoryToken(for sessionId: String?) {
        _ = beginHistoryRequest(for: sessionId)
    }

    func setFocusedSessionId(_ value: String?) {
        sessionId = value
    }

    func prepareSessionSwitch(_ newSessionId: String) {
        let previousSessionId = sessionId
        sessionId = newSessionId
        messages = []
        lockedProvider = nil
        bumpHistoryToken(for: previousSessionId)
        bumpHistoryToken(for: newSessionId)
        // sessionStreams is untouched — background sessions keep accumulating
    }

    func removeSessionState(_ removedSessionId: String, fallbackSessionId: String?) {
        sessionStreams.removeValue(forKey: removedSessionId)
        historyTokenBySession.removeValue(forKey: removedSessionId)

        guard sessionId == removedSessionId else { return }

        messages = []
        lockedProvider = nil

        if let fallbackSessionId, fallbackSessionId != removedSessionId {
            sessionId = fallbackSessionId
            bumpHistoryToken(for: fallbackSessionId)
        } else {
            sessionId = nil
        }
    }

    // MARK: - Private

    /// Ensure a stream slot exists for the given session, defaulting to streaming state.
    private func ensureStream(for sid: String, streaming: Bool = true) {
        if sessionStreams[sid] == nil {
            var stream = SessionStreamState()
            stream.isStreaming = streaming
            if streaming {
                stream.streamingStartedAt = Date()
            }
            sessionStreams[sid] = stream
        }
    }

    private func parseStartedAt(_ rawStartedAt: Double) -> Date {
        let seconds = rawStartedAt > 10_000_000_000 ? rawStartedAt / 1000 : rawStartedAt
        return Date(timeIntervalSince1970: seconds)
    }

    private func upsertAgentActivity(_ activity: AgentActivity, for sid: String) {
        guard var stream = sessionStreams[sid] else { return }
        if let index = stream.activeAgentActivities.firstIndex(where: { $0.id == activity.id }) {
            stream.activeAgentActivities[index] = activity
        } else {
            stream.activeAgentActivities.append(activity)
        }
        sessionStreams[sid] = stream
    }

    private func hasTerminalAssistantMessage(for sid: String) -> Bool {
        for message in messages.reversed() {
            if !message.sessionId.isEmpty && message.sessionId != sid {
                continue
            }
            return message.role == .assistant
        }
        return false
    }

    private func finalizeMessage(sessionId sid: String, durationMs: Int?, cancelled: Bool,
                                 errorDetail: String? = nil,
                                 inputTokens: Int? = nil, outputTokens: Int? = nil,
                                 contextUsedTokens: Int? = nil, contextWindowTokens: Int? = nil) {
        guard let stream = sessionStreams[sid] else { return }

        let isActive = sid == sessionId
        let hasContent = !stream.currentText.isEmpty || !stream.activeToolCalls.isEmpty
            || !stream.activeAgentActivities.isEmpty || !stream.currentThinking.isEmpty

        // Remove stream slot FIRST so the chat view never shows both the
        // finalized message (in `messages`) and the in-progress streaming
        // bubble (derived from `sessionStreams`) at once. The local `stream`
        // is a value-type copy captured above, so it survives this removal.
        sessionStreams.removeValue(forKey: sid)

        if isActive {
            if hasContent {
                let msg = ChatMessage(
                    id: UUID().uuidString,
                    sessionId: sid,
                    role: .assistant,
                    content: stream.currentText,
                    images: nil,
                    toolCalls: stream.activeToolCalls.isEmpty ? nil : stream.activeToolCalls,
                    agentActivities: stream.activeAgentActivities.isEmpty ? nil : stream.activeAgentActivities,
                    thinkingContent: stream.currentThinking.isEmpty ? nil : stream.currentThinking,
                    timestamp: Self.outgoingTimestampFormatter.string(from: Date()),
                    cancelled: cancelled ? true : nil,
                    errorDetail: errorDetail,
                    durationMs: durationMs,
                    inputTokens: inputTokens,
                    outputTokens: outputTokens,
                    contextUsedTokens: contextUsedTokens,
                    contextWindowTokens: contextWindowTokens
                )
                messages.append(msg)
            } else if cancelled {
                let msg = ChatMessage(
                    id: UUID().uuidString,
                    sessionId: sid,
                    role: .assistant,
                    content: "",
                    images: nil, toolCalls: nil, thinkingContent: nil,
                    timestamp: Self.outgoingTimestampFormatter.string(from: Date()),
                    cancelled: true, errorDetail: errorDetail,
                    durationMs: nil
                )
                messages.append(msg)
            }
        }
    }

    /// Derive pending tool inputs from history — mirrors frontend's derivePendingToolInputsFromHistory.
    /// If the last assistant message has unanswered AskUserQuestion/ExitPlanMode tool calls
    /// with no user message after, they become pending.
    private func derivePendingToolInputsFromHistory(_ msgs: [ChatMessage]) -> [PendingToolInput] {
        guard let lastAssistantIdx = msgs.lastIndex(where: { $0.role == .assistant }) else {
            return []
        }
        let hasUserAfter = msgs[(lastAssistantIdx + 1)...].contains { $0.role == .user }
        if hasUserAfter { return [] }

        let toolCalls = msgs[lastAssistantIdx].toolCalls ?? []
        return toolCalls
            .filter { $0.name == "AskUserQuestion" || $0.name == "ExitPlanMode" }
            .map { tool in
                PendingToolInput(
                    sessionId: msgs[lastAssistantIdx].sessionId,
                    requestId: "history-\(tool.id)",
                    toolName: tool.name,
                    toolUseId: tool.id,
                    input: tool.input
                )
            }
    }
}

// MARK: - Pending Tool Input

struct PendingToolInput: Identifiable {
    var id: String { requestId }
    let sessionId: String
    let requestId: String
    let toolName: String
    let toolUseId: String
    let input: String
}
