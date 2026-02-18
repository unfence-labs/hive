import Foundation
import Observation

@MainActor
@Observable
final class ConversationStore {
    // MARK: - Public state

    var messages: [ChatMessage] = []
    var isStreaming = false
    var streamingStartedAt: Date?
    var isBusy = false

    /// Session currently displayed in chat.
    var sessionId: String?

    // Transient streaming accumulators — exposed for the view to render live
    var currentText = ""
    var currentThinking = ""
    var activeToolCalls: [ToolCall] = []

    // Pending tool inputs (AskUserQuestion / ExitPlanMode) — can be multiple
    var pendingToolInputs: [PendingToolInput] = []

    // Branch & diff info (pushed via WS)
    var branchInfo: BranchInfo?
    var diffStats: DiffStatResponse?

    // MARK: - Computed

    /// The in-progress assistant message shown during streaming
    var streamingMessage: ChatMessage? {
        guard isStreaming, !currentText.isEmpty || !currentThinking.isEmpty || !activeToolCalls.isEmpty else {
            return nil
        }
        return ChatMessage(
            id: "streaming",
            sessionId: "",
            role: .assistant,
            content: currentText,
            images: nil,
            toolCalls: activeToolCalls.isEmpty ? nil : activeToolCalls,
            thinkingContent: currentThinking.isEmpty ? nil : currentThinking,
            timestamp: ISO8601DateFormatter().string(from: Date()),
            cancelled: nil,
            durationMs: nil
        )
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
        case .textDelta(_, let text):
            beginStreamingIfNeeded(startedAt: nil)
            currentText += text

        case .thinking(_, let text):
            beginStreamingIfNeeded(startedAt: nil)
            currentThinking += text

        case .toolUse(_, let id, let name, let input, let parentToolUseId):
            beginStreamingIfNeeded(startedAt: nil)
            activeToolCalls.append(ToolCall(
                id: id, name: name, input: input,
                output: nil, parentToolUseId: parentToolUseId
            ))

        case .toolResult(_, let toolUseId, let output):
            if let idx = activeToolCalls.firstIndex(where: { $0.id == toolUseId }) {
                let tc = activeToolCalls[idx]
                activeToolCalls[idx] = ToolCall(
                    id: tc.id, name: tc.name, input: tc.input,
                    output: output, parentToolUseId: tc.parentToolUseId
                )
            }

        case .toolInputRequired(let sessionId, let requestId, let toolName, let toolUseId, let input):
            pendingToolInputs.append(PendingToolInput(
                sessionId: sessionId, requestId: requestId,
                toolName: toolName, toolUseId: toolUseId, input: input
            ))

        case .done(let sessionId, _, let durationMs):
            self.sessionId = sessionId
            finalizeMessage(sessionId: sessionId, durationMs: durationMs, cancelled: false)

        case .cancelled(let sessionId):
            self.sessionId = sessionId
            finalizeMessage(sessionId: sessionId, durationMs: nil, cancelled: true)

        case .error(let message):
            messages.append(ChatMessage(
                id: UUID().uuidString, sessionId: "", role: .assistant,
                content: "Error: \(message)", images: nil, toolCalls: nil,
                thinkingContent: nil, timestamp: ISO8601DateFormatter().string(from: Date()),
                cancelled: nil, durationMs: nil
            ))

        case .status(let status, let incomingSessionId, let streaming, let startedAt):
            // Ignore status updates for non-focused sessions.
            if let current = sessionId,
               let incomingSessionId,
               incomingSessionId != current {
                return
            }

            if let incomingSessionId {
                sessionId = incomingSessionId
            }

            let newIsStreaming = streaming ?? (status == .idle ? false : isStreaming)
            isBusy = status == .busy || streaming == true

            if newIsStreaming {
                beginStreamingIfNeeded(startedAt: startedAt)
            } else {
                resetStreaming()
            }

        case .userMessage(let msg):
            messages.append(msg)
            sessionId = msg.sessionId
            beginStreamingIfNeeded(startedAt: nil)
            // Clear pending tool inputs when user sends a new message (like frontend)
            pendingToolInputs = []

        case .history(let msgs, let incomingSessionId):
            if !isStreaming {
                messages = msgs
                sessionId = incomingSessionId ?? msgs.first?.sessionId
                // Derive pending tool inputs from history
                pendingToolInputs = derivePendingToolInputsFromHistory(msgs)
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
        pendingToolInputs = []
    }

    func setFocusedSessionId(_ value: String?) {
        sessionId = value
    }

    func prepareSessionSwitch(_ newSessionId: String) {
        sessionId = newSessionId
        messages = []
        pendingToolInputs = []
        resetStreaming()
    }

    // MARK: - Private

    private func finalizeMessage(sessionId: String, durationMs: Int?, cancelled: Bool) {
        let hasContent = !currentText.isEmpty || !activeToolCalls.isEmpty || !currentThinking.isEmpty
        if hasContent {
            let msg = ChatMessage(
                id: UUID().uuidString,
                sessionId: sessionId,
                role: .assistant,
                content: currentText,
                images: nil,
                toolCalls: activeToolCalls.isEmpty ? nil : activeToolCalls,
                thinkingContent: currentThinking.isEmpty ? nil : currentThinking,
                timestamp: ISO8601DateFormatter().string(from: Date()),
                cancelled: cancelled ? true : nil,
                durationMs: durationMs
            )
            messages.append(msg)
        } else if cancelled {
            let msg = ChatMessage(
                id: UUID().uuidString,
                sessionId: sessionId,
                role: .assistant,
                content: "",
                images: nil, toolCalls: nil, thinkingContent: nil,
                timestamp: ISO8601DateFormatter().string(from: Date()),
                cancelled: true,
                durationMs: nil
            )
            messages.append(msg)
        }
        resetStreaming()
    }

    private func resetStreaming() {
        isStreaming = false
        streamingStartedAt = nil
        currentText = ""
        currentThinking = ""
        activeToolCalls = []
    }

    private func beginStreamingIfNeeded(startedAt rawStartedAt: Double?) {
        isStreaming = true
        guard streamingStartedAt == nil else { return }

        if let rawStartedAt {
            // Backend sends Unix milliseconds; accept seconds defensively.
            let seconds = rawStartedAt > 10_000_000_000 ? rawStartedAt / 1000 : rawStartedAt
            streamingStartedAt = Date(timeIntervalSince1970: seconds)
        } else {
            streamingStartedAt = Date()
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
