import SwiftUI

struct WorkspaceConversationsView: View {
    private let maxSessions = 4

    let workspace: Workspace
    let store: ConversationStore
    @Binding var navigationPath: NavigationPath

    @Environment(ProjectStore.self) private var projectStore

    @State private var sessions: [SessionMetadata] = []
    @State private var isLoading = true
    @State private var isCreatingSession = false
    @State private var errorMessage: String?

    private let api = APIClient()
    private var activeSessionId: String? {
        store.sessionId ?? workspace.activeSessionId
    }

    var body: some View {
        List {
            ForEach(sessions) { session in
                Button {
                    navigationPath.append(session)
                } label: {
                    ConversationRow(
                        session: session,
                        isActive: session.sessionId == activeSessionId,
                        isStreaming: projectStore.statusMonitor.isStreaming(
                            workspaceId: workspace.id,
                            sessionId: session.sessionId
                        ),
                        isUnread: projectStore.statusMonitor.isUnread(
                            workspaceId: workspace.id,
                            sessionId: session.sessionId
                        )
                    )
                }
                .buttonStyle(.plain)
                .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
                .listRowBackground(WhisperColor.appBackground)
                .listRowSeparatorTint(WhisperColor.separator)
            }
            .onDelete(perform: deleteSessions)
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .hiveScreenBackground()
        .overlay {
            if isLoading {
                ProgressView()
            } else if sessions.isEmpty {
                VStack(spacing: HiveSpacing.sm) {
                    Text("No Conversations")
                        .font(.headline)
                        .foregroundStyle(WhisperColor.text)
                    Text("Create a conversation to start messaging in this workspace.")
                        .font(.subheadline)
                        .foregroundStyle(WhisperColor.textSecondary)
                        .multilineTextAlignment(.center)
                }
                .padding(.horizontal, HiveSpacing.xl)
            }
        }
        .refreshable {
            await loadSessions()
        }
        .navigationTitle(workspace.name)
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: SessionMetadata.self) { session in
            ChatView(workspace: workspace, session: session, store: store)
        }
        .toolbarBackground(WhisperColor.appBackground, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    createSession()
                } label: {
                    if isCreatingSession {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Image(systemName: "plus")
                    }
                }
                .disabled(sessions.count >= maxSessions || isCreatingSession)
                .accessibilityLabel("New conversation")
            }
        }
        .task {
            markWorkspaceVisible()
            await loadSessions()
        }
        .onAppear {
            markWorkspaceVisible()
            if !isLoading {
                Task { await loadSessions() }
            }
        }
        .alert("Conversation Error", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            if let errorMessage {
                Text(errorMessage)
            }
        }
    }

    private func markWorkspaceVisible() {
        projectStore.statusMonitor.viewingWorkspaceId = workspace.id
        projectStore.statusMonitor.viewingSessionId = nil
        projectStore.statusMonitor.clearCompleted(workspace.id)
    }

    private func loadSessions() async {
        do {
            sessions = try await api.fetchSessions(workspaceId: workspace.id)
            errorMessage = nil
        } catch is CancellationError {
            // View disappeared.
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func createSession() {
        guard sessions.count < maxSessions, !isCreatingSession else { return }

        isCreatingSession = true
        Task {
            defer { isCreatingSession = false }

            do {
                let session = try await api.createSession(workspaceId: workspace.id)
                sessions.insert(session, at: 0)
                errorMessage = nil
                navigationPath.append(session)
            } catch is CancellationError {
                // View disappeared.
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func deleteSessions(at offsets: IndexSet) {
        let targets = offsets.compactMap { index -> SessionMetadata? in
            sessions.indices.contains(index) ? sessions[index] : nil
        }
        let focusedSessionId = activeSessionId

        Task {
            var deletedSessionIds = Set<String>()
            for session in targets {
                do {
                    try await api.deleteSession(workspaceId: workspace.id, sessionId: session.sessionId)
                    ChatDraftStore.shared.remove(workspaceId: workspace.id, sessionId: session.sessionId)
                    projectStore.statusMonitor.clearUnread(workspaceId: workspace.id, sessionId: session.sessionId)
                    deletedSessionIds.insert(session.sessionId)
                    errorMessage = nil
                } catch is CancellationError {
                    // View disappeared.
                } catch {
                    errorMessage = error.localizedDescription
                }
            }

            guard !deletedSessionIds.isEmpty else { return }

            sessions.removeAll { deletedSessionIds.contains($0.sessionId) }

            if let focusedSessionId, deletedSessionIds.contains(focusedSessionId) {
                let fallbackSessionId = sessions.first?.sessionId
                if store.sessionId == nil {
                    store.setFocusedSessionId(focusedSessionId)
                }
                store.removeSessionState(focusedSessionId, fallbackSessionId: fallbackSessionId)
                if let fallbackSessionId {
                    _ = await store.send?(.switchSession(sessionId: fallbackSessionId))
                }
            }

            for deletedSessionId in deletedSessionIds {
                if let focusedSessionId, deletedSessionId == focusedSessionId {
                    continue
                }
                store.removeSessionState(deletedSessionId, fallbackSessionId: nil)
            }
        }
    }
}
