import Testing
@testable import HiveMobileStoresCore

struct ConversationStoreAgentActivityTests {
    @Test @MainActor
    func upsertsLiveAgentActivityById() {
        let store = ConversationStore()
        store.handle(.status(
            status: .busy,
            sessionId: "session-1",
            streaming: true,
            streamingStartedAt: nil,
            lockedProvider: "codex"
        ))

        store.handle(.agentActivity(
            sessionId: "session-1",
            activity: .commandExecution(.init(
                id: "cmd-1",
                command: "swift test",
                cwd: nil,
                status: "inProgress",
                output: "partial",
                exitCode: nil,
                durationMs: nil
            ))
        ))
        store.handle(.agentActivity(
            sessionId: "session-1",
            activity: .commandExecution(.init(
                id: "cmd-1",
                command: "swift test",
                cwd: nil,
                status: "completed",
                output: "complete",
                exitCode: 0,
                durationMs: 250
            ))
        ))

        #expect(store.activeAgentActivities.count == 1)
        guard let firstActivity = store.activeAgentActivities.first,
              case .commandExecution(let command) = firstActivity else {
            Issue.record("Expected command execution activity")
            return
        }
        #expect(command.status == "completed")
        #expect(command.output == "complete")
        #expect(command.exitCode == 0)
    }

    @Test @MainActor
    func donePersistsAgentActivitiesIntoFinalMessage() {
        let store = ConversationStore()
        store.handle(.status(
            status: .busy,
            sessionId: "session-1",
            streaming: true,
            streamingStartedAt: nil,
            lockedProvider: "codex"
        ))
        store.handle(.agentActivity(
            sessionId: "session-1",
            activity: .planUpdate(.init(
                id: "plan-1",
                steps: [
                    .init(text: "Inspect", status: "completed"),
                    .init(text: "Patch", status: "inProgress")
                ]
            ))
        ))

        store.handle(.done(
            sessionId: "session-1",
            durationMs: 1000,
            inputTokens: 10,
            outputTokens: 5,
            pendingToolName: nil
        ))

        let message = store.messages.first
        #expect(message?.agentActivities?.count == 1)
        #expect(message?.durationMs == 1000)
        #expect(store.activeAgentActivities.isEmpty)
    }

    @Test @MainActor
    func ignoresLateLiveFragmentsAfterDone() {
        let store = ConversationStore()
        store.handle(.userMessage(message: ChatMessage(
            id: "user-1",
            sessionId: "session-1",
            role: .user,
            content: "hello",
            images: nil,
            toolCalls: nil,
            thinkingContent: nil,
            timestamp: "2026-02-12T00:00:00.000Z",
            cancelled: nil,
            durationMs: nil
        )))
        store.handle(.textDelta(sessionId: "session-1", text: "Done"))
        store.handle(.done(
            sessionId: "session-1",
            durationMs: 100,
            inputTokens: nil,
            outputTokens: nil,
            pendingToolName: nil
        ))

        #expect(store.isStreaming == false)
        #expect(store.sessionStreams["session-1"] == nil)
        #expect(store.messages.count == 2)
        #expect(store.messages.last?.content == "Done")

        store.handle(.textDelta(sessionId: "session-1", text: " late text"))
        store.handle(.thinking(sessionId: "session-1", text: "late thinking"))
        store.handle(.toolUse(
            sessionId: "session-1",
            id: "late-tool",
            name: "Read",
            input: "{}",
            parentToolUseId: nil
        ))
        store.handle(.agentActivity(
            sessionId: "session-1",
            activity: .commandExecution(.init(
                id: "late-command",
                command: "swift test",
                cwd: nil,
                status: "completed",
                output: nil,
                exitCode: 0,
                durationMs: nil
            ))
        ))
        store.handle(.toolInputRequired(
            sessionId: "session-1",
            requestId: "late-input",
            toolName: "AskUserQuestion",
            toolUseId: "late-tool",
            input: "{}"
        ))
        store.handle(.planModeChanged(sessionId: "session-1", active: true))

        #expect(store.isStreaming == false)
        #expect(store.currentText.isEmpty)
        #expect(store.currentThinking.isEmpty)
        #expect(store.activeToolCalls.isEmpty)
        #expect(store.activeAgentActivities.isEmpty)
        #expect(store.pendingToolInputs.isEmpty)
        #expect(store.agentPlanMode == nil)
        #expect(store.sessionStreams["session-1"] == nil)
        #expect(store.messages.count == 2)
        #expect(store.messages.last?.content == "Done")
    }
}
