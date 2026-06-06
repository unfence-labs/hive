import Foundation

/// In-memory store for unsent chat input drafts, keyed by workspace + session.
/// Mirrors the frontend's `useChatInputDraftPersistence` behavior:
/// drafts survive navigation between workspaces and session switches
/// but are intentionally lost on app termination.
@MainActor
final class ChatDraftStore {
    static let shared = ChatDraftStore()

    struct Attachment: Equatable {
        var name: String
        var mediaType: String
        var dataUrl: String
    }

    struct Draft {
        var text: String
        var planModeEnabled: Bool
        var thinkingLevel: ThinkingLevel
        var fastModeEnabled: Bool
        var selectedModelId: String?
        var attachments: [Attachment]

        var hasMeaningfulContent: Bool {
            !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                || !attachments.isEmpty
                || planModeEnabled
                || fastModeEnabled
                || thinkingLevel != .high
                || selectedModelId != nil
        }
    }

    // [workspaceId: [sessionId: Draft]]
    private var store: [String: [String: Draft]] = [:]

    private init() {}

    func save(workspaceId: String, sessionId: String, draft: Draft) {
        if draft.hasMeaningfulContent {
            store[workspaceId, default: [:]][sessionId] = draft
        } else {
            store[workspaceId]?[sessionId] = nil
            if store[workspaceId]?.isEmpty == true {
                store[workspaceId] = nil
            }
        }
    }

    func restore(workspaceId: String, sessionId: String) -> Draft? {
        store[workspaceId]?[sessionId]
    }

    func remove(workspaceId: String, sessionId: String) {
        store[workspaceId]?[sessionId] = nil
        if store[workspaceId]?.isEmpty == true {
            store[workspaceId] = nil
        }
    }
}
