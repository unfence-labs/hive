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

    // Pending tool input (AskUserQuestion / ExitPlanMode)
    var pendingToolInput: PendingToolInput?

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
            pendingToolInput = PendingToolInput(
                sessionId: sessionId, requestId: requestId,
                toolName: toolName, toolUseId: toolUseId, input: input
            )

        case .done(let sessionId, _, let durationMs):
            finalizeMessage(sessionId: sessionId, durationMs: durationMs, cancelled: false)

        case .cancelled(let sessionId):
            finalizeMessage(sessionId: sessionId, durationMs: nil, cancelled: true)

        case .error(let message):
            // Append as a system-like assistant message
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

        case .history(let msgs, _):
            // Only replace if not actively streaming
            if !isStreaming {
                messages = msgs
            }

        case .branchInfo(let info):
            branchInfo = info

        case .diffStats(let stats):
            diffStats = stats
        }
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
