import Foundation
import Testing
@testable import HiveMobileStoresCore

struct ChatDraftStoreTests {
    @Test @MainActor
    func saveAndRestoreDraftWithAttachments() {
        let workspaceId = "ws-\(UUID().uuidString)"
        let sessionId = "sess-\(UUID().uuidString)"

        let attachment = ChatDraftStore.Attachment(
            name: "image.jpg",
            mediaType: "image/jpeg",
            dataUrl: "data:image/jpeg;base64,abcd"
        )

        ChatDraftStore.shared.save(
            workspaceId: workspaceId,
            sessionId: sessionId,
            draft: .init(
                text: "hello",
                attachments: [attachment]
            )
        )

        let restored = ChatDraftStore.shared.restore(workspaceId: workspaceId, sessionId: sessionId)
        #expect(restored?.text == "hello")
        #expect(restored?.attachments == [attachment])

        ChatDraftStore.shared.remove(workspaceId: workspaceId, sessionId: sessionId)
    }

    @Test @MainActor
    func saveEmptyDraftDoesNotPersist() {
        let workspaceId = "ws-\(UUID().uuidString)"
        let sessionId = "sess-\(UUID().uuidString)"

        ChatDraftStore.shared.save(
            workspaceId: workspaceId,
            sessionId: sessionId,
            draft: .init(
                text: "   ",
                attachments: []
            )
        )

        #expect(ChatDraftStore.shared.restore(workspaceId: workspaceId, sessionId: sessionId) == nil)
    }

    @Test @MainActor
    func removeDeletesPersistedDraft() {
        let workspaceId = "ws-\(UUID().uuidString)"
        let sessionId = "sess-\(UUID().uuidString)"

        ChatDraftStore.shared.save(
            workspaceId: workspaceId,
            sessionId: sessionId,
            draft: .init(
                text: "persist me",
                attachments: []
            )
        )

        #expect(ChatDraftStore.shared.restore(workspaceId: workspaceId, sessionId: sessionId) != nil)

        ChatDraftStore.shared.remove(workspaceId: workspaceId, sessionId: sessionId)
        #expect(ChatDraftStore.shared.restore(workspaceId: workspaceId, sessionId: sessionId) == nil)
    }
}
