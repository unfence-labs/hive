import Foundation
import Observation

// MARK: - Per-session streaming state

struct SessionStreamState {
    var currentText = ""
    var currentThinking = ""
    var activeToolCalls: [ToolCall] = []
    var isStreaming = false
    var streamingStartedAt: Date?
    var pendingToolInputs: [PendingToolInput] = []
}

@MainActor
@Observable
final class ConversationStore {
    private static let outgoingTimestampFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    // MARK: - Public state

    /// Send closure wired by HubStatusMonitor to the workspace's WS connection.
    var send: ((WsIncoming) async -> Void)?

    var messages: [ChatMessage] = []
    var isBusy = false

    /// Session currently displayed in chat.
    var sessionId: String?

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

    var isStreaming: Bool { activeStream?.isStreaming ?? false }
    var streamingStartedAt: Date? { activeStream?.streamingStartedAt }
    var currentText: String { activeStream?.currentText ?? "" }
    var currentThinking: String { activeStream?.currentThinking ?? "" }
    var activeToolCalls: [ToolCall] { activeStream?.activeToolCalls ?? [] }
    var pendingToolInputs: [PendingToolInput] { activeStream?.pendingToolInputs ?? [] }

    /// The in-progress assistant message shown during streaming
    var streamingMessage: ChatMessage? {
        guard let stream = activeStream,
              stream.isStreaming,
              !stream.currentText.isEmpty || !stream.currentThinking.isEmpty || !stream.activeToolCalls.isEmpty else {
            return nil
        }
        return ChatMessage(
            id: "streaming",
            sessionId: "",
            role: .assistant,
            content: stream.currentText,
            images: nil,
            toolCalls: stream.activeToolCalls.isEmpty ? nil : stream.activeToolCalls,
            thinkingContent: stream.currentThinking.isEmpty ? nil : stream.currentThinking,
            timestamp: Self.outgoingTimestampFormatter.string(from: Date()),
            cancelled: nil,
            durationMs: nil
        )
    }

    /// Derived task tracking state from all TaskCreate/TaskUpdate tool calls.
    var tasksState: TasksState {
        deriveTasks(from: messages, activeToolCalls: activeStream?.activeToolCalls ?? [])
    }

    /// All messages to display: history + streaming message if active
    var displayMessages: [ChatMessage] {
        if let streaming = streamingMessage {
            return messages + [streaming]
        }
        return messages
    }

    // MARK: - Event handling

    func handle(_ event: WsOutgoing) {
        switch event {
        case .textDelta(let sid, let text):
            ensureStream(for: sid)
            sessionStreams[sid]?.currentText += text

        case .thinking(let sid, let text):
            ensureStream(for: sid)
            sessionStreams[sid]?.currentThinking += text

        case .toolUse(let sid, let id, let name, let input, let parentToolUseId):
            ensureStream(for: sid)
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

        case .toolInputRequired(let sid, let requestId, let toolName, let toolUseId, let input):
            ensureStream(for: sid)
            sessionStreams[sid]?.pendingToolInputs.append(PendingToolInput(
                sessionId: sid, requestId: requestId,
                toolName: toolName, toolUseId: toolUseId, input: input
            ))

        case .done(let sid, _, let durationMs):
            finalizeMessage(sessionId: sid, durationMs: durationMs, cancelled: false)

        case .cancelled(let sid):
            finalizeMessage(sessionId: sid, durationMs: nil, cancelled: true)

        case .error(let message, let errorSessionId):
            if let errorSessionId, let currentSessionId = sessionId, errorSessionId != currentSessionId {
                return
            }
            messages.append(ChatMessage(
                id: UUID().uuidString, sessionId: "", role: .assistant,
                content: "Error: \(message)", images: nil, toolCalls: nil,
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
                        if stream.streamingStartedAt == nil {
                            stream.streamingStartedAt = parseStartedAt(startedAt)
                        }
                        sessionStreams[sid] = stream
                    }
                } else if var stream = sessionStreams[sid] {
                    // Session stopped streaming. Clean up if no content.
                    if stream.currentText.isEmpty && stream.currentThinking.isEmpty
                        && stream.activeToolCalls.isEmpty && stream.pendingToolInputs.isEmpty {
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

            isBusy = status == .busy || streaming == true

        case .userMessage(let msg):
            let sid = msg.sessionId
            let isActive = sessionId == nil || sid == sessionId
            if isActive {
                messages.append(msg)
            }
            sessionId = sessionId ?? sid
            ensureStream(for: sid)
            sessionStreams[sid]?.currentText = ""
            sessionStreams[sid]?.currentThinking = ""
            sessionStreams[sid]?.activeToolCalls = []
            sessionStreams[sid]?.pendingToolInputs = []

        case .history(let msgs, let incomingSessionId):
            let historySessionId = incomingSessionId ?? msgs.first?.sessionId ?? sessionId
            // Only update messages for the active session
            guard historySessionId == nil || sessionId == nil || historySessionId == sessionId else { return }

            let activeStream = historySessionId.flatMap { sessionStreams[$0] }
            if activeStream?.isStreaming != true {
                messages = msgs
                sessionId = historySessionId ?? sessionId
                // Derive pending tool inputs from history
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
        }
    }

    func clearPendingToolInputs() {
        guard let sid = sessionId else { return }
        sessionStreams[sid]?.pendingToolInputs = []
    }

    func setFocusedSessionId(_ value: String?) {
        sessionId = value
    }

    func prepareSessionSwitch(_ newSessionId: String) {
        sessionId = newSessionId
        messages = []
        lockedProvider = nil
        // sessionStreams is untouched — background sessions keep accumulating
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

    private func parseStartedAt(_ rawStartedAt: Double?) -> Date {
        guard let rawStartedAt else { return Date() }
        let seconds = rawStartedAt > 10_000_000_000 ? rawStartedAt / 1000 : rawStartedAt
        return Date(timeIntervalSince1970: seconds)
    }

    private func finalizeMessage(sessionId sid: String, durationMs: Int?, cancelled: Bool) {
        guard let stream = sessionStreams[sid] else { return }

        let isActive = sid == sessionId
        let hasContent = !stream.currentText.isEmpty || !stream.activeToolCalls.isEmpty || !stream.currentThinking.isEmpty

        if isActive {
            if hasContent {
                let msg = ChatMessage(
                    id: UUID().uuidString,
                    sessionId: sid,
                    role: .assistant,
                    content: stream.currentText,
                    images: nil,
                    toolCalls: stream.activeToolCalls.isEmpty ? nil : stream.activeToolCalls,
                    thinkingContent: stream.currentThinking.isEmpty ? nil : stream.currentThinking,
                    timestamp: Self.outgoingTimestampFormatter.string(from: Date()),
                    cancelled: cancelled ? true : nil,
                    durationMs: durationMs
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
                    cancelled: true,
                    durationMs: nil
                )
                messages.append(msg)
            }
        }
        // Clean up the slot — REST fetch on switch-back will include the completed message.
        sessionStreams.removeValue(forKey: sid)
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
