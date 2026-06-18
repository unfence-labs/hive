import Foundation
import Testing
@testable import HiveMobileStoresCore

struct SessionMetadataDecodingTests {
    @Test
    func decodesSessionMetadataFields() throws {
        let data = """
        {
          "sessionId": "session-1",
          "providerSessionId": "provider-session-1",
          "claudeSessionId": "claude-session-1",
          "workspaceId": "workspace-1",
          "title": "Refactor navigation",
          "createdAt": "2026-01-01T00:00:00.000Z",
          "updatedAt": "2026-01-02T00:00:00.000Z",
          "messageCount": 7,
          "lockedProvider": "codex",
          "kind": "chat",
          "lastRunOptions": {
            "planMode": false,
            "model": "codex:gpt-5.5",
            "thinkingLevel": "low",
            "fastMode": false
          }
        }
        """.data(using: .utf8)!

        let metadata = try JSONDecoder().decode(SessionMetadata.self, from: data)

        #expect(metadata.sessionId == "session-1")
        #expect(metadata.providerSessionId == "provider-session-1")
        #expect(metadata.claudeSessionId == "claude-session-1")
        #expect(metadata.workspaceId == "workspace-1")
        #expect(metadata.title == "Refactor navigation")
        #expect(metadata.createdAt == "2026-01-01T00:00:00.000Z")
        #expect(metadata.updatedAt == "2026-01-02T00:00:00.000Z")
        #expect(metadata.messageCount == 7)
        #expect(metadata.lockedProvider == "codex")
        #expect(metadata.kind == "chat")
        #expect(metadata.lastRunOptions?.model == "codex:gpt-5.5")
        #expect(metadata.lastRunOptions?.thinkingLevel == .low)
        #expect(metadata.lastRunOptions?.planMode == false)
        #expect(metadata.lastRunOptions?.fastMode == false)
        #expect(metadata.id == "session-1")
    }

    @Test
    func decodesSessionMetadataWithoutOptionalFields() throws {
        let data = """
        {
          "sessionId": "session-2",
          "workspaceId": "workspace-1",
          "createdAt": "2026-01-03T00:00:00.000Z",
          "updatedAt": "2026-01-04T00:00:00.000Z",
          "messageCount": 0
        }
        """.data(using: .utf8)!

        let metadata = try JSONDecoder().decode(SessionMetadata.self, from: data)

        #expect(metadata.sessionId == "session-2")
        #expect(metadata.providerSessionId == nil)
        #expect(metadata.claudeSessionId == nil)
        #expect(metadata.title == nil)
        #expect(metadata.lockedProvider == nil)
        #expect(metadata.kind == nil)
        #expect(metadata.lastRunOptions == nil)
    }
}
