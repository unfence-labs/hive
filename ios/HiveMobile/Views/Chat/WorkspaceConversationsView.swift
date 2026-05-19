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
    @State private var selectedSession: SessionMetadata?
    @State private var isShowingSelectedSession = false
    @State private var errorMessage: String?

    private let api = APIClient()
    private var activeSessionId: String? {
        store.sessionId ?? workspace.activeSessionId
    }

    var body: some View {
        List {
            ForEach(sessions) { session in
                Button {
                    isOpeningConversation = true
                    selectedSession = session
                    isShowingSelectedSession = true
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
        .navigationDestination(isPresented: $isShowingSelectedSession) {
            if let selectedSession {
                ChatView(workspace: workspace, session: selectedSession, store: store)
            }
        }
        .onChange(of: isShowingSelectedSession) { _, isPresented in
            if !isPresented {
                selectedSession = nil
            }
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
                    projectStore.statusMonitor.clearUnread(workspaceId: workspace.id, sessionId: session.sessionId)
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
