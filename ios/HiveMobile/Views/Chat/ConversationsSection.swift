import SwiftUI

/// Reusable conversation-list surface shared by `WorkspaceConversationsView` and
/// the Brain. Owns the session list state (load/create/delete), the toolbar add
/// button, navigation into `ChatView`, and the session error alert. The dashboard
/// above the list is supplied by the caller via `header`, and any caller-specific
/// data (workspace scripts, Brain status) refreshes through `onExtraRefresh`.
struct ConversationsSection<Header: View>: View {
    // Keep in sync with the web cap (MAX_SESSIONS_PER_WORKSPACE in
    // ConversationTabs.tsx) and the backend Brain guard (MAX_BRAIN_SESSIONS).
    private let maxSessions = 6

    let workspace: Workspace
    let store: ConversationStore
    @Binding var navigationPath: NavigationPath
    let labels: ConversationsSectionLabels
    let onExtraRefresh: (() async -> Void)?
    let header: Header

    init(
        workspace: Workspace,
        store: ConversationStore,
        navigationPath: Binding<NavigationPath>,
        labels: ConversationsSectionLabels = .workspace,
        onExtraRefresh: (() async -> Void)? = nil,
        @ViewBuilder header: () -> Header
    ) {
        self.workspace = workspace
        self.store = store
        self._navigationPath = navigationPath
        self.labels = labels
        self.onExtraRefresh = onExtraRefresh
        self.header = header()
    }

    @Environment(ProjectStore.self) private var projectStore

    @State private var sessions: [SessionMetadata] = []
    @State private var isLoading = true
    @State private var isCreatingSession = false
    @State private var errorMessage: String?
    @State private var actionErrorMessage: String?
    @State private var sessionToDelete: SessionMetadata?
    @State private var lastRefreshAt = Date.distantPast

    private let api = APIClient()
    private var focusedSessionId: String? {
        store.sessionId ?? workspace.activeSessionId
    }

    var body: some View {
        VStack(spacing: HiveSpacing.md) {
            header

            conversationsSection
                .frame(maxHeight: .infinity)
        }
        .hiveScreenBackground()
        .navigationTitle(workspace.name)
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: SessionMetadata.self) { session in
            ChatView(workspace: workspace, session: session, store: store)
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                ToolbarAddButton(
                    isLoading: isCreatingSession,
                    accessibilityLabel: "New conversation"
                ) {
                    createSession()
                }
                .disabled(sessions.count >= maxSessions || isCreatingSession)
            }
        }
        .task {
            markWorkspaceVisible()
            await refreshContent()
        }
        .onAppear {
            markWorkspaceVisible()
            if !isLoading {
                Task { await refreshContent() }
            }
        }
        .alert(labels.errorTitle, isPresented: Binding(
            get: { errorMessage != nil && !sessions.isEmpty },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            if let errorMessage {
                Text(errorMessage)
            }
        }
        .alert(labels.errorTitle, isPresented: Binding(
            get: { actionErrorMessage != nil },
            set: { if !$0 { actionErrorMessage = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            if let actionErrorMessage {
                Text(actionErrorMessage)
            }
        }
        .alert(
            "Delete conversation?",
            isPresented: Binding(
                get: { sessionToDelete != nil },
                set: { if !$0 { sessionToDelete = nil } }
            ),
            presenting: sessionToDelete
        ) { session in
            Button("Delete", role: .destructive) {
                deleteSession(session)
            }
            Button("Cancel", role: .cancel) {}
        } message: { session in
            Text("\"\(session.displayTitle)\" will be permanently deleted.")
        }
    }

    private var conversationsSection: some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: HiveSpacing.sm) {
                Text("Conversations")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(WhisperColor.text)

                Text("\(sessions.count)/\(maxSessions)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(WhisperColor.textMuted)

                Spacer(minLength: HiveSpacing.sm)
            }
            .padding(.horizontal, HiveSpacing.lg)
            .padding(.bottom, 2)

            conversationsList
        }
    }

    private var conversationsList: some View {
        List {
            ForEach(sessions) { session in
                Button {
                    navigationPath.append(session)
                } label: {
                    ConversationRow(
                        session: session,
                        monitor: projectStore.statusMonitor,
                        workspaceId: workspace.id
                    )
                }
                .buttonStyle(.plain)
                .listRowInsets(EdgeInsets(top: 5, leading: HiveSpacing.lg, bottom: 5, trailing: HiveSpacing.lg))
                .listRowBackground(WhisperColor.appBackground)
                .listRowSeparator(.hidden)
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button {
                        sessionToDelete = session
                    } label: {
                        Image(systemName: "trash")
                            .imageScale(.small)
                    }
                    .tint(WhisperColor.danger)
                    .accessibilityLabel("Delete conversation")
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .refreshable {
            projectStore.statusMonitor.forceRefresh()
            await refreshContent(force: true)
        }
        .overlay {
            if isLoading, sessions.isEmpty {
                ListLoadingSkeleton()
            } else if let errorMessage, sessions.isEmpty {
                ContentUnavailableView {
                    Label("Couldn't load conversations", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("Retry") { Task { await refreshContent(force: true) } }
                        .buttonStyle(.borderedProminent)
                }
            } else if !isLoading, sessions.isEmpty {
                VStack(spacing: HiveSpacing.sm) {
                    Text(labels.emptyTitle)
                        .font(.headline)
                        .foregroundStyle(WhisperColor.text)
                    Text(labels.emptyDescription)
                        .font(.subheadline)
                        .foregroundStyle(WhisperColor.textSecondary)
                        .multilineTextAlignment(.center)
                    Button("New conversation") {
                        createSession()
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(sessions.count >= maxSessions || isCreatingSession)
                }
                .padding(.horizontal, HiveSpacing.xl)
            }
        }
    }

    private func markWorkspaceVisible() {
        projectStore.statusMonitor.setViewingWorkspace(workspace.id, sessionId: nil)
        projectStore.statusMonitor.clearCompleted(workspace.id)
    }

    private func refreshContent(force: Bool = false) async {
        if !force, Date().timeIntervalSince(lastRefreshAt) < 0.5 { return }
        lastRefreshAt = Date()
        await loadSessions()
        await onExtraRefresh?()
    }

    private func loadSessions() async {
        do {
            // Terminal sessions are a desktop-only surface; hide them on mobile.
            sessions = try await api.fetchSessions(workspaceId: workspace.id)
                .filter { $0.kind != "terminal" }
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
                actionErrorMessage = error.localizedDescription
            }
        }
    }

    private func deleteSession(_ session: SessionMetadata) {
        let deletedFocusedSessionId = focusedSessionId

        Task {
            let outcome = await store.deleteSession(
                session,
                from: sessions,
                focusedSessionId: deletedFocusedSessionId
            ) { sessionId in
                try await api.deleteSession(workspaceId: workspace.id, sessionId: sessionId)
                ChatDraftStore.shared.remove(workspaceId: workspace.id, sessionId: sessionId)
                projectStore.statusMonitor.clearUnread(workspaceId: workspace.id, sessionId: sessionId)
            }
            if outcome.deleted {
                sessions.removeAll { $0.sessionId == session.sessionId }
            }
            actionErrorMessage = outcome.errorMessage
        }
    }
}
