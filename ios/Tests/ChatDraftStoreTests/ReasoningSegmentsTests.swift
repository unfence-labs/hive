import Foundation
import Testing
@testable import HiveMobileStoresCore

struct ReasoningSegmentsTests {
    @Test
    func decodesStructuredThoughtsAndDropsEmptyOnes() throws {
        let data = Data("""
        {
          "id": "message-1",
          "sessionId": "session-1",
          "role": "assistant",
          "content": "Answer",
          "reasoningSegments": [
            { "id": "reasoning-1:0", "headline": "First phase", "body": "the body" },
            { "id": "reasoning-1:1" },
            { "id": "reasoning-2:0", "headline": "Second phase" }
          ],
          "timestamp": "2026-07-10T00:00:00.000Z"
        }
        """.utf8)

        let message = try JSONDecoder().decode(ChatMessage.self, from: data)
        let segments = try #require(message.reasoningSegments)

        #expect(segments.map(\.id) == ["reasoning-1:0", "reasoning-1:1", "reasoning-2:0"])
        #expect(segments[0].headline == "First phase")
        #expect(segments[0].body == "the body")
        // A thought with neither headline nor body has nothing to show, so drop it.
        #expect(message.resolvedReasoningSegments.map(\.id) == ["reasoning-1:0", "reasoning-2:0"])
    }

    @Test
    func decodesThinkingEventSegments() throws {
        let data = Data("""
        {
          "type": "thinking",
          "sessionId": "session-1",
          "blockId": "reasoning-1",
          "segments": [
            { "id": "reasoning-1:0", "headline": "Inspecting", "body": "the repo" }
          ]
        }
        """.utf8)

        let event = try JSONDecoder().decode(WsOutgoing.self, from: data)
        guard case .thinking(let sessionId, let blockId, let segments) = event else {
            Issue.record("Expected thinking event")
            return
        }
        #expect(sessionId == "session-1")
        #expect(blockId == "reasoning-1")
        #expect(segments.map(\.id) == ["reasoning-1:0"])
        #expect(segments[0].headline == "Inspecting")
        #expect(segments[0].body == "the repo")
    }

    @Test
    func decodesReasoningSegmentsFromStreamSnapshot() throws {
        let data = Data("""
        {
          "type": "stream_snapshot",
          "sessionId": "session-1",
          "text": "",
          "reasoningSegments": [
            { "id": "reasoning-1:0", "headline": "Canonical" },
            { "id": "reasoning-2:0" }
          ],
          "toolCalls": [],
          "agentActivities": [],
          "agentPlanMode": false
        }
        """.utf8)

        let event = try JSONDecoder().decode(WsOutgoing.self, from: data)
        guard case .streamSnapshot(_, _, _, _, _, _, let segments) = event else {
            Issue.record("Expected stream snapshot")
            return
        }
        #expect(segments.map(\.id) == ["reasoning-1:0", "reasoning-2:0"])
        #expect(segments[0].headline == "Canonical")
    }

    @Test @MainActor
    func thinkingEventMergesLiveReasoningSegmentsByBlock() {
        let store = makeStreamingStore()

        store.handle(.thinking(sessionId: "session-1", blockId: "reasoning-1", segments: [
            ReasoningSegment(id: "reasoning-1:0", headline: nil, body: "First"),
        ]))
        store.handle(.thinking(sessionId: "session-1", blockId: "reasoning-1", segments: [
            ReasoningSegment(id: "reasoning-1:0", headline: nil, body: "First phase"),
        ]))
        store.handle(.thinking(sessionId: "session-1", blockId: "reasoning-2", segments: [
            ReasoningSegment(id: "reasoning-2:0", headline: "Second phase", body: nil),
        ]))

        #expect(store.reasoningSegments.isEmpty)
        store.flushStreamingDeltas()

        #expect(store.reasoningSegments.map(\.id) == ["reasoning-1:0", "reasoning-2:0"])
        #expect(store.reasoningSegments[0].body == "First phase")
        #expect(store.reasoningSegments[1].headline == "Second phase")
    }

    @Test @MainActor
    func snapshotReplacesPendingDeltasWithCanonicalSegments() {
        let store = makeStreamingStore()
        store.handle(.thinking(sessionId: "session-1", blockId: "stale", segments: [
            ReasoningSegment(id: "stale:0", headline: nil, body: "stale"),
        ]))

        let canonical = [
            ReasoningSegment(id: "reasoning-1:0", headline: "Canonical", body: nil),
            ReasoningSegment(id: "reasoning-2:0", headline: nil, body: nil),
        ]
        store.handle(.streamSnapshot(
            sessionId: "session-1",
            text: "",
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
    func doneFinalizesAndCachesSegments() throws {
        let store = makeStreamingStore()
        store.handle(.thinking(sessionId: "session-1", blockId: "reasoning-1", segments: [
            ReasoningSegment(id: "reasoning-1:0", headline: "Reasoning", body: nil),
        ]))

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
        #expect(segments.map(\.id) == ["reasoning-1:0"])
        #expect(segments[0].headline == "Reasoning")
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
