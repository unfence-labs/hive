import Foundation
import Testing
@testable import HiveMobileStoresCore

struct ReasoningSegmentsTests {
    @Test
    func decodesTypedSegmentsAndPrefersThemOverLegacyThinking() throws {
        let data = Data("""
        {
          "id": "message-1",
          "sessionId": "session-1",
          "role": "assistant",
          "content": "Answer",
          "thinkingContent": "Legacy reasoning",
          "reasoningSegments": [
            { "id": "reasoning-1", "kind": "thinking", "content": "First phase" },
            { "id": "reasoning-2", "kind": "redacted" },
            { "id": "reasoning-3", "kind": "thinking", "content": "Second phase" }
          ],
          "timestamp": "2026-07-10T00:00:00.000Z"
        }
        """.utf8)

        let message = try JSONDecoder().decode(ChatMessage.self, from: data)
        let segments = try #require(message.reasoningSegments)

        #expect(segments.map(\.id) == ["reasoning-1", "reasoning-2", "reasoning-3"])
        #expect(segments.map(\.kind) == [.thinking, .redacted, .thinking])
        #expect(segments[1].content == nil)
        #expect(message.resolvedReasoningSegments == segments)
    }

    @Test
    func legacyHistoryDerivesOneThinkingSegment() throws {
        let data = Data("""
        {
          "id": "message-1",
          "sessionId": "session-1",
          "role": "assistant",
          "content": "Answer",
          "thinkingContent": "Legacy reasoning",
          "timestamp": "2026-07-10T00:00:00.000Z"
        }
        """.utf8)

        let message = try JSONDecoder().decode(ChatMessage.self, from: data)
        let segment = try #require(message.resolvedReasoningSegments.first)

        #expect(message.reasoningSegments == nil)
        #expect(segment.id == "legacy-thinking")
        #expect(segment.kind == .thinking)
        #expect(segment.content == "Legacy reasoning")
    }

    @Test
    func decodesTypedAndLegacyThinkingEvents() throws {
        let typedData = Data("""
        {
          "type": "thinking",
          "sessionId": "session-1",
          "text": "Inspecting",
          "segmentId": "reasoning-1",
          "kind": "thinking"
        }
        """.utf8)
        let legacyData = Data("""
        {
          "type": "thinking",
          "sessionId": "session-1",
          "text": "Legacy"
        }
        """.utf8)

        let typed = try JSONDecoder().decode(WsOutgoing.self, from: typedData)
        let legacy = try JSONDecoder().decode(WsOutgoing.self, from: legacyData)

        guard case .thinking(let sessionId, let text, let segmentId, let kind) = typed else {
            Issue.record("Expected typed thinking event")
            return
        }
        #expect(sessionId == "session-1")
        #expect(text == "Inspecting")
        #expect(segmentId == "reasoning-1")
        #expect(kind == .thinking)

        guard case .thinking(_, let legacyText, let legacySegmentId, let legacyKind) = legacy else {
            Issue.record("Expected legacy thinking event")
            return
        }
        #expect(legacyText == "Legacy")
        #expect(legacySegmentId == nil)
        #expect(legacyKind == nil)
    }

    @Test
    func decodesReasoningSegmentsFromStreamSnapshot() throws {
        let data = Data("""
        {
          "type": "stream_snapshot",
          "sessionId": "session-1",
          "text": "",
          "thinking": "Legacy aggregate",
          "reasoningSegments": [
            { "id": "reasoning-1", "kind": "thinking", "content": "Canonical" },
            { "id": "reasoning-2", "kind": "redacted" }
          ],
          "toolCalls": [],
          "agentActivities": [],
          "agentPlanMode": false
        }
        """.utf8)

        let event = try JSONDecoder().decode(WsOutgoing.self, from: data)

        guard case .streamSnapshot(_, _, let legacyThinking, _, _, _, _, let segments) = event else {
            Issue.record("Expected stream snapshot")
            return
        }
        #expect(legacyThinking == "Legacy aggregate")
        #expect(segments.map(\.kind) == [.thinking, .redacted])
        #expect(segments[1].content == nil)
    }

    @Test @MainActor
    func bufferedDeltasUpsertBySegmentIdAndRetainRedactedPhases() {
        let store = makeStreamingStore()

        store.handle(.thinking(
            sessionId: "session-1", text: "First ",
            segmentId: "reasoning-1", kind: .thinking
        ))
        store.handle(.thinking(
            sessionId: "session-1", text: "phase",
            segmentId: "reasoning-1", kind: .thinking
        ))
        store.handle(.thinking(
            sessionId: "session-1", text: "provider payload",
            segmentId: "reasoning-2", kind: .redacted
        ))
        store.handle(.thinking(
            sessionId: "session-1", text: "Second phase",
            segmentId: "reasoning-3", kind: .thinking
        ))

        #expect(store.reasoningSegments.isEmpty)
        store.flushStreamingDeltas()

        #expect(store.reasoningSegments.map(\.id) == ["reasoning-1", "reasoning-2", "reasoning-3"])
        #expect(store.reasoningSegments[0].content == "First phase")
        #expect(store.reasoningSegments[1].kind == .redacted)
        #expect(store.reasoningSegments[1].content == nil)
        #expect(store.reasoningSegments[2].content == "Second phase")
        #expect(store.currentThinking.isEmpty)
    }

    @Test @MainActor
    func snapshotReplacesPendingDeltasWithCanonicalSegments() {
        let store = makeStreamingStore()
        store.handle(.thinking(
            sessionId: "session-1", text: "stale",
            segmentId: "stale-segment", kind: .thinking
        ))

        let canonical = [
            ReasoningSegment(id: "reasoning-1", kind: .thinking, content: "Canonical"),
            ReasoningSegment(id: "reasoning-2", kind: .redacted, content: nil)
        ]
        store.handle(.streamSnapshot(
            sessionId: "session-1",
            text: "",
            thinking: "",
            toolCalls: [],
            agentActivities: [],
            agentPlanMode: false,
            streamingStartedAt: nil,
            reasoningSegments: canonical
        ))
        store.flushStreamingDeltas()

        #expect(store.reasoningSegments == canonical)
    }

    @Test @MainActor
    func doneFinalizesAndCachesTypedSegments() throws {
        let store = makeStreamingStore()
        store.handle(.thinking(
            sessionId: "session-1", text: "Reasoning",
            segmentId: "reasoning-1", kind: .thinking
        ))
        store.handle(.thinking(
            sessionId: "session-1", text: "",
            segmentId: "reasoning-2", kind: .redacted
        ))

        store.handle(.done(
            sessionId: "session-1",
            durationMs: 100,
            inputTokens: nil,
            outputTokens: nil,
            contextUsedTokens: nil,
            contextWindowTokens: nil,
            pendingToolName: nil
        ))

        let message = try #require(store.messages.last)
        let segments = try #require(message.reasoningSegments)
        #expect(segments.map(\.kind) == [.thinking, .redacted])
        #expect(message.thinkingContent == nil)
        #expect(store.cachedMessages(for: "session-1")?.last?.reasoningSegments == segments)
        #expect(store.sessionStreams["session-1"] == nil)
    }

    @MainActor
    private func makeStreamingStore() -> ConversationStore {
        let store = ConversationStore(streamFlushInterval: nil)
        store.handle(.status(
            status: .busy,
            sessionId: "session-1",
            streaming: true,
            streamingStartedAt: nil,
            lockedProvider: "codex"
        ))
        return store
    }
}
