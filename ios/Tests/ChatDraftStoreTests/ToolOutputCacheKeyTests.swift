import Foundation
import Testing
@testable import HiveMobileStoresCore

/// Tests for the PRD #254 tool-output cache key scoping. Codex tool ids are
/// sequential per turn (`item_1`, `item_2`, …) and so repeat across
/// sessions/workspaces. The expand-output cache must therefore key by the
/// session scope (workspaceId + sessionId) plus the tool id, never the tool id
/// alone — otherwise expanding `item_1` in session A would serve A's body when
/// expanding `item_1` in session B.
///
/// `ToolOutputCache` itself lives in the SwiftUI View layer (excluded from this
/// test module), so we exercise its pure key builder `toolOutputCacheKey`, which
/// is the sole source of the cache key.
struct ToolOutputCacheKeyTests {
    /// A minimal cache mirroring `ToolOutputCache`'s storage + keying so the
    /// store/read collision behaviour can be asserted directly.
    private struct FakeCache {
        private var outputs: [String: String] = [:]

        mutating func store(_ output: String, workspaceId: String, sessionId: String, toolId: String) {
            outputs[toolOutputCacheKey(workspaceId: workspaceId, sessionId: sessionId, toolId: toolId)] = output
        }

        func value(workspaceId: String, sessionId: String, toolId: String) -> String? {
            outputs[toolOutputCacheKey(workspaceId: workspaceId, sessionId: sessionId, toolId: toolId)]
        }
    }

    @Test
    func sameToolIdDifferentSessionsDoNotCollide() {
        var cache = FakeCache()
        let workspace = "ws-1"

        // Session A stores its body under tool id "item_1".
        cache.store("output-A", workspaceId: workspace, sessionId: "session-A", toolId: "item_1")

        // Session B reads "item_1" — must MISS (forcing the correct fetch),
        // not return session A's body.
        #expect(cache.value(workspaceId: workspace, sessionId: "session-B", toolId: "item_1") == nil)

        // Reading back under session A's own context returns A's body.
        #expect(cache.value(workspaceId: workspace, sessionId: "session-A", toolId: "item_1") == "output-A")
    }

    @Test
    func sameToolIdDifferentWorkspacesDoNotCollide() {
        var cache = FakeCache()

        cache.store("output-W1", workspaceId: "ws-1", sessionId: "s", toolId: "item_1")

        // Same session id + tool id but a different workspace must MISS.
        #expect(cache.value(workspaceId: "ws-2", sessionId: "s", toolId: "item_1") == nil)
        #expect(cache.value(workspaceId: "ws-1", sessionId: "s", toolId: "item_1") == "output-W1")
    }

    @Test
    func keyIsStableAndScopeSensitive() {
        let a = toolOutputCacheKey(workspaceId: "ws", sessionId: "s", toolId: "item_1")
        let aAgain = toolOutputCacheKey(workspaceId: "ws", sessionId: "s", toolId: "item_1")
        #expect(a == aAgain)

        // Each scope component independently changes the key.
        #expect(a != toolOutputCacheKey(workspaceId: "ws2", sessionId: "s", toolId: "item_1"))
        #expect(a != toolOutputCacheKey(workspaceId: "ws", sessionId: "s2", toolId: "item_1"))
        #expect(a != toolOutputCacheKey(workspaceId: "ws", sessionId: "s", toolId: "item_2"))
    }
}
