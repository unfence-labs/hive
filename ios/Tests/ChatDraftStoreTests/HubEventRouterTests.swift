import Testing
@testable import HiveMobileStoresCore

@MainActor
private final class RecordingSink: HubEventSink {
    var calls: [String] = []

    func didReceiveActivity(_ event: WsOutgoing, for workspaceId: String) {
        calls.append("activity:\(workspaceId)")
    }

    func didReceiveStreaming(_ streaming: Bool, for workspaceId: String, sessionId: String?) {
        calls.append("streaming:\(streaming):\(workspaceId):\(sessionId ?? "nil")")
    }

    func ensureStoreExists(for workspaceId: String) {
        calls.append("ensureStore:\(workspaceId)")
    }

    func checkBackgroundCompletion(for workspaceId: String) {
        calls.append("bgCompletion:\(workspaceId)")
    }

    func didReceiveDiffStats(_ stats: DiffStatResponse, for workspaceId: String) {
        calls.append("diffStats:\(workspaceId)")
    }

    func didReceivePrStatus(_ status: PrStatusResponse, for workspaceId: String) {
        calls.append("prStatus:\(workspaceId)")
    }

    func didReceiveBranchInfo(_ info: BranchInfo, for workspaceId: String) {
        calls.append("branchInfo:\(workspaceId)")
    }

    func didReceiveScriptStatus(scriptType: String, state: String, exitCode: Int?, for workspaceId: String) {
        calls.append("scriptStatus:\(workspaceId)")
    }

    func didReceiveDone(for workspaceId: String, sessionId: String?, markWorkspaceCompleted: Bool) {
        calls.append("done:\(workspaceId):\(sessionId ?? "nil"):\(markWorkspaceCompleted)")
    }

    func forward(_ event: WsOutgoing, for workspaceId: String) {
        calls.append("forward:\(workspaceId)")
    }
}

@MainActor
struct HubEventRouterTests {
    @Test
    func statusStreamingTrueEnsuresStoreAndSkipsBackgroundCompletion() {
        let sink = RecordingSink()
        let envelope = HubOutgoing(
            workspaceId: "ws-1",
            event: .status(status: .busy, sessionId: "s1", streaming: true, streamingStartedAt: nil, lockedProvider: nil)
        )

        HubEventRouter.route(envelope, to: sink)

        #expect(sink.calls == [
            "activity:ws-1",
            "streaming:true:ws-1:s1",
            "ensureStore:ws-1",
            "forward:ws-1"
        ])
    }

    @Test
    func statusStreamingFalseChecksBackgroundCompletionAndSkipsEnsureStore() {
        let sink = RecordingSink()
        let envelope = HubOutgoing(
            workspaceId: "ws-1",
            event: .status(status: .idle, sessionId: "s1", streaming: false, streamingStartedAt: nil, lockedProvider: nil)
        )

        HubEventRouter.route(envelope, to: sink)

        #expect(sink.calls == [
            "activity:ws-1",
            "streaming:false:ws-1:s1",
            "bgCompletion:ws-1",
            "forward:ws-1"
        ])
    }

    @Test
    func statusStreamingNilDefaultsToFalse() {
        let sink = RecordingSink()
        let envelope = HubOutgoing(
            workspaceId: "ws-1",
            event: .status(status: .idle, sessionId: "s1", streaming: nil, streamingStartedAt: nil, lockedProvider: nil)
        )

        HubEventRouter.route(envelope, to: sink)

        #expect(sink.calls == [
            "activity:ws-1",
            "streaming:false:ws-1:s1",
            "bgCompletion:ws-1",
            "forward:ws-1"
        ])
    }

    @Test
    func doneMarksWorkspaceCompleted() {
        let sink = RecordingSink()
        let envelope = HubOutgoing(
            workspaceId: "ws-1",
            event: .done(sessionId: "s1", durationMs: nil, inputTokens: nil, outputTokens: nil, contextUsedTokens: nil, contextWindowTokens: nil, pendingToolName: nil)
        )

        HubEventRouter.route(envelope, to: sink)

        #expect(sink.calls == [
            "activity:ws-1",
            "streaming:false:ws-1:s1",
            "done:ws-1:s1:true",
            "forward:ws-1"
        ])
    }

    @Test
    func cancelledWithUserInitiatedNilMarksNotCompleted() {
        let sink = RecordingSink()
        let envelope = HubOutgoing(
            workspaceId: "ws-1",
            event: .cancelled(sessionId: "s1", errorDetail: nil, userInitiated: nil, durationMs: nil)
        )

        HubEventRouter.route(envelope, to: sink)

        #expect(sink.calls == [
            "activity:ws-1",
            "streaming:false:ws-1:s1",
            "done:ws-1:s1:false",
            "forward:ws-1"
        ])
    }

    @Test
    func cancelledWithUserInitiatedFalseMarksNotCompleted() {
        let sink = RecordingSink()
        let envelope = HubOutgoing(
            workspaceId: "ws-1",
            event: .cancelled(sessionId: "s1", errorDetail: nil, userInitiated: false, durationMs: nil)
        )

        HubEventRouter.route(envelope, to: sink)

        #expect(sink.calls == [
            "activity:ws-1",
            "streaming:false:ws-1:s1",
            "done:ws-1:s1:false",
            "forward:ws-1"
        ])
    }

    @Test
    func cancelledWithUserInitiatedTrueSkipsDone() {
        let sink = RecordingSink()
        let envelope = HubOutgoing(
            workspaceId: "ws-1",
            event: .cancelled(sessionId: "s1", errorDetail: nil, userInitiated: true, durationMs: nil)
        )

        HubEventRouter.route(envelope, to: sink)

        #expect(sink.calls == [
            "activity:ws-1",
            "streaming:false:ws-1:s1",
            "forward:ws-1"
        ])
    }

    @Test
    func streamSnapshotMarksStreamingAndEnsuresStore() {
        let sink = RecordingSink()
        let envelope = HubOutgoing(
            workspaceId: "ws-1",
            event: .streamSnapshot(
                sessionId: "s1",
                text: "",
                toolCalls: [],
                agentActivities: [],
                agentPlanMode: false,
                streamingStartedAt: nil
            )
        )

        HubEventRouter.route(envelope, to: sink)

        #expect(sink.calls == [
            "activity:ws-1",
            "streaming:true:ws-1:s1",
            "ensureStore:ws-1",
            "forward:ws-1"
        ])
    }

    @Test
    func defaultCaseOnlyForwardsAndMarksActivity() {
        let sink = RecordingSink()
        let envelope = HubOutgoing(
            workspaceId: "ws-1",
            event: .textDelta(sessionId: "s1", text: "hello")
        )

        HubEventRouter.route(envelope, to: sink)

        #expect(sink.calls == [
            "activity:ws-1",
            "forward:ws-1"
        ])
    }
}
