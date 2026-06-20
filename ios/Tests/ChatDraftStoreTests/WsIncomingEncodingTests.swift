import Foundation
import Testing
@testable import HiveMobileStoresCore

/// Encoding tests for the PRD #254 Finding #1 "always pull on focus" contract:
/// `switch_session` must encode WITH `sessionId` when the client knows it, and
/// must OMIT the key entirely when the id is unknown (a sessionId-less
/// `switch_session` is a deterministic focus pull on the workspace's active
/// session). Kept aligned with backend/frontend, where `switch_session.sessionId`
/// is optional.
struct WsIncomingEncodingTests {
    private func encodeToObject(_ message: WsIncoming) throws -> [String: Any] {
        let data = try JSONEncoder().encode(message)
        let object = try JSONSerialization.jsonObject(with: data)
        return try #require(object as? [String: Any])
    }

    @Test
    func switchSessionWithKnownIdEncodesSessionId() throws {
        let object = try encodeToObject(.switchSession(sessionId: "session-1"))

        #expect(object["type"] as? String == "switch_session")
        #expect(object["sessionId"] as? String == "session-1")
    }

    @Test
    func switchSessionWithUnknownIdOmitsSessionId() throws {
        // First open of an already-subscribed streaming workspace: the client
        // has no session id yet but must still pull. The encoded payload carries
        // NO sessionId key (not null) so the backend treats it as a focus pull on
        // the active session.
        let object = try encodeToObject(.switchSession(sessionId: nil))

        #expect(object["type"] as? String == "switch_session")
        #expect(object["sessionId"] == nil)
        #expect(object.keys.contains("sessionId") == false)
    }
}
