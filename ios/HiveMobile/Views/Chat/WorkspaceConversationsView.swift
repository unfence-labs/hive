import SwiftUI

struct WorkspaceConversationsView: View {
    private let maxSessions = 4

    let workspace: Workspace
    let store: ConversationStore

    @Environment(ProjectStore.self) private var projectStore

    @State private var sessions: [SessionMetadata] = []
    @State private var isLoading = true
    @State private var isCreatingSession = false
    @State private var isOpeningConversation = false
    @State private var errorMessage: String?

    private let api = APIClient()
    private var activeSessionId: String? {
        store.sessionId ?? workspace.activeSessionId
    }
    private var branchName: String {
        projectStore.statusMonitor.branchInfo(for: workspace.id)?.name ?? workspace.branch
    }

    var body: some View {
        List {
            ForEach(sessions) { session in
                NavigationLink {
                    ChatView(workspace: workspace, session: session, store: store)
                } label: {
                    ConversationRow(
                        session: session,
                        isActive: session.sessionId == activeSessionId
                    )
                }
                .simultaneousGesture(TapGesture().onEnded {
                    isOpeningConversation = true
                })
                .listRowBackground(WhisperColor.surfaceRaised)
            }
            .onDelete(perform: deleteSessions)
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .hiveScreenBackground()
        .overlay {
            if isLoading {
                ProgressView()
            } else if sessions.isEmpty {
                ContentUnavailableView(
                    "No Conversations",
                    systemImage: "bubble.left.and.bubble.right",
                    description: Text("Create a conversation to start messaging in this workspace.")
                )
            }
        }
        .refreshable {
            await loadSessions()
        }
        .navigationTitle(workspace.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(WhisperColor.appBackground, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 2) {
                    Text(workspace.projectName ?? workspace.name)
                        .font(.headline)
                        .lineLimit(1)
                    Text("\(workspace.name) · \(branchName)")
                        .font(.caption2)
                        .foregroundStyle(WhisperColor.textSecondary)
                        .lineLimit(1)
                }
            }
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
            isOpeningConversation = false
            markWorkspaceVisible()
            if !isLoading {
                Task { await loadSessions() }
            }
        }
        .onDisappear {
            if !isOpeningConversation,
               projectStore.statusMonitor.viewingWorkspaceId == workspace.id {
                projectStore.statusMonitor.viewingWorkspaceId = nil
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

        Task {
            var deletedSessionIds = Set<String>()
            for session in targets {
                do {
                    try await api.deleteSession(workspaceId: workspace.id, sessionId: session.sessionId)
                    ChatDraftStore.shared.remove(workspaceId: workspace.id, sessionId: session.sessionId)
                    deletedSessionIds.insert(session.sessionId)
                    errorMessage = nil
                } catch is CancellationError {
                    // View disappeared.
                } catch {
                    errorMessage = error.localizedDescription
                }
            }
            sessions.removeAll { deletedSessionIds.contains($0.sessionId) }
        }
    }
}
