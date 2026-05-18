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
}
