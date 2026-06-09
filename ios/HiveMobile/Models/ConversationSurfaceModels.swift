import Foundation

struct ConversationsSectionLabels: Equatable {
    let errorTitle: String
    let emptyTitle: String
    let emptyDescription: String

    static let workspace = ConversationsSectionLabels(
        errorTitle: "Workspace Error",
        emptyTitle: "No Conversations",
        emptyDescription: "Create a conversation to start messaging in this workspace."
    )

    static let brain = ConversationsSectionLabels(
        errorTitle: "Brain Error",
        emptyTitle: "No Conversations",
        emptyDescription: "Create a conversation to start working with your Brain."
    )
}

func isBrainWorkspaceId(_ workspaceId: String) -> Bool {
    workspaceId == BRAIN_WORKSPACE_ID
}

func makeBrainWorkspace(from state: BrainState?) -> Workspace {
    Workspace(
        id: BRAIN_WORKSPACE_ID,
        name: "Brain",
        branch: "main",
        status: .idle,
        createdAt: state?.createdAt ?? "",
        activeSessionId: nil,
        projectName: "Brain",
        defaultBranch: nil
    )
}

func brainSaveFailureMessage(
    result: BrainSaveResponse? = nil,
    fallbackErrorDescription: String? = nil
) -> String {
    if let message = result?.error?.trimmingCharacters(in: .whitespacesAndNewlines),
       !message.isEmpty {
        return message
    }

    if result?.committed == true && result?.pushed == false {
        return "Brain was saved locally, but push failed."
    }

    if let message = fallbackErrorDescription?.trimmingCharacters(in: .whitespacesAndNewlines),
       !message.isEmpty {
        return message
    }

    return "Brain save failed."
}
