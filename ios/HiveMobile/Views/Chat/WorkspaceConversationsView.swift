import SwiftUI

struct WorkspaceConversationsView: View {
    let workspace: Workspace
    let store: ConversationStore
    @Binding var navigationPath: NavigationPath

    @Environment(ProjectStore.self) private var projectStore

    @State private var scriptsResponse: WorkspaceScriptsResponse?
    @State private var scriptsLoadFailed = false
    @State private var pendingScriptAction: ScriptDashboardAction?
    @State private var isPerformingScriptAction = false
    @State private var scriptErrorMessage: String?

    private let api = APIClient()

    var body: some View {
        ConversationsSection(
            workspace: workspace,
            store: store,
            navigationPath: $navigationPath,
            onExtraRefresh: loadScripts
        ) {
            WorkspaceDashboardPanel(
                workspace: workspace,
                branchInfo: projectStore.statusMonitor.branchInfo(for: workspace.id),
                diffStats: projectStore.statusMonitor.diffStats(for: workspace.id),
                scriptsResponse: scriptsResponse,
                liveScriptStatus: projectStore.statusMonitor.scriptStatus(for: workspace.id),
                prStatus: projectStore.statusMonitor.prStatus(for: workspace.id),
                isStreaming: projectStore.statusMonitor.isStreaming(workspace.id),
                hasUnread: projectStore.statusMonitor.hasUnreadSessions(workspace.id),
                scriptsLoadFailed: scriptsLoadFailed,
                onScriptAction: { action in
                    guard !isPerformingScriptAction else { return }
                    pendingScriptAction = action
                },
                onDiffTap: {
                    navigationPath.append(WorkspaceDiffDestination(workspace: workspace))
                }
            )
        }
        .navigationDestination(for: WorkspaceDiffDestination.self) { destination in
            ChangedFilesView(workspace: destination.workspace, navigationPath: $navigationPath)
        }
        .navigationDestination(for: WorkspaceFileDiffDestination.self) { destination in
            WorkspaceFileDiffView(
                workspace: destination.workspace,
                scope: destination.scope,
                paths: destination.paths,
                navigationPath: $navigationPath,
                index: destination.index
            )
        }
        .alert(
            pendingScriptAction?.title ?? "Script Action",
            isPresented: Binding(
                get: { pendingScriptAction != nil },
                set: { if !$0 { pendingScriptAction = nil } }
            ),
            presenting: pendingScriptAction
        ) { action in
            Button(action.confirmTitle, role: action.isDestructive ? .destructive : nil) {
                performScriptAction(action)
            }
            Button("Cancel", role: .cancel) {}
        } message: { action in
            Text(action.message)
        }
        .alert("Workspace Error", isPresented: Binding(
            get: { scriptErrorMessage != nil },
            set: { if !$0 { scriptErrorMessage = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            if let scriptErrorMessage {
                Text(scriptErrorMessage)
            }
        }
    }

    private func loadScripts() async {
        do {
            scriptsResponse = try await api.fetchWorkspaceScripts(workspaceId: workspace.id)
            scriptsLoadFailed = false
        } catch is CancellationError {
            // View disappeared.
        } catch {
            scriptsLoadFailed = true
        }
    }

    private func performScriptAction(_ action: ScriptDashboardAction) {
        guard !isPerformingScriptAction else { return }

        pendingScriptAction = nil
        isPerformingScriptAction = true
        Task {
            defer { isPerformingScriptAction = false }

            do {
                switch action.kind {
                case .start:
                    try await api.startWorkspaceScript(workspaceId: workspace.id, scriptId: action.scriptId)
                case .stop:
                    try await api.stopWorkspaceScript(workspaceId: workspace.id, scriptId: action.scriptId)
                case .restart:
                    try await restartSetup(action)
                }

                scriptErrorMessage = nil
                projectStore.statusMonitor.forceRefresh()
                await loadScripts()
            } catch is CancellationError {
                // View disappeared.
            } catch {
                scriptErrorMessage = error.localizedDescription
                await loadScripts()
            }
        }
    }

    private func restartSetup(_ action: ScriptDashboardAction) async throws {
        do {
            try await api.stopWorkspaceScript(workspaceId: workspace.id, scriptId: action.scriptId)
        } catch APIError.httpError(let statusCode, _) where statusCode == 409 {
            // Nothing was running; starting setup still gives the expected restart action.
        }

        try await api.startWorkspaceScript(workspaceId: workspace.id, scriptId: action.scriptId)
    }
}
