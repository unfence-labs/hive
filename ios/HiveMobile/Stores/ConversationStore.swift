import Foundation
import Observation

@MainActor
@Observable
final class ConversationStore {
    // MARK: - Public state

    var messages: [ChatMessage] = []
    var isStreaming = false
    var isBusy = false

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
            isStreaming = true
            currentText += text

        case .thinking(_, let text):
            isStreaming = true
            currentThinking += text

        case .toolUse(_, let id, let name, let input, let parentToolUseId):
            isStreaming = true
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
            finalizeMessage(sessionId: sessionId, durationMs: durationMs, cancelled: false)

        case .cancelled(let sessionId):
            finalizeMessage(sessionId: sessionId, durationMs: nil, cancelled: true)

        case .error(let message):
            messages.append(ChatMessage(
                id: UUID().uuidString, sessionId: "", role: .assistant,
                content: "Error: \(message)", images: nil, toolCalls: nil,
                thinkingContent: nil, timestamp: ISO8601DateFormatter().string(from: Date()),
                cancelled: nil, durationMs: nil
            ))

        case .status(let status, _, let streaming, _):
            isBusy = status == .busy || streaming == true

        case .userMessage(let msg):
            messages.append(msg)
            // Clear pending tool inputs when user sends a new message (like frontend)
            pendingToolInputs = []

        case .history(let msgs, _):
            if !isStreaming {
                messages = msgs
                // Derive pending tool inputs from history
                pendingToolInputs = derivePendingToolInputsFromHistory(msgs)
            }

        case .branchInfo(let info):
            branchInfo = info

        case .diffStats(let stats):
            diffStats = stats
        }
    }

    func clearPendingToolInputs() {
        pendingToolInputs = []
    }

    // MARK: - Private

    private func finalizeMessage(sessionId: String, durationMs: Int?, cancelled: Bool) {
        if !currentText.isEmpty || !activeToolCalls.isEmpty || !currentThinking.isEmpty {
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
        }
        resetStreaming()
    }

    private func resetStreaming() {
        isStreaming = false
        currentText = ""
        currentThinking = ""
        activeToolCalls = []
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
