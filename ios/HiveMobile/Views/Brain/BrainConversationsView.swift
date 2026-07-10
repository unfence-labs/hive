import SwiftUI

/// Brain landing screen. Reuses the workspace conversation stack (via
/// `ConversationsSection`) against the synthetic `"brain"` workspace, swapping
/// the workspace dashboard for the Save panel. Shows a simple empty state when
/// no Brain is connected.
struct BrainConversationsView: View {
    let store: ConversationStore
    @Binding var navigationPath: NavigationPath

    @Environment(ProjectStore.self) private var projectStore

    @State private var brainState: BrainState?
    @State private var stateLoadFailed = false
    @State private var brainStatus: BrainStatusResponse?
    @State private var brainDiff: BrainDiffResponse?
    @State private var statusLoading = true
    @State private var statusError = false
    @State private var diffLoading = true
    @State private var diffError = false
    @State private var hasLoadedStatusOnce = false
    @State private var saveIndicator: BrainSaveIndicator = .idle
    @State private var saveErrorMessage: String?
    @State private var savedResetTask: Task<Void, Never>?

    private let api = APIClient()

    private var brainWorkspace: Workspace {
        makeBrainWorkspace(from: brainState)
    }

    private var pendingCount: Int {
        brainStatus?.count ?? 0
    }

    private var unpushedCommitCount: Int? {
        brainStatus?.unpushedCommitCount
    }

    private var lastSyncedAt: String? {
        brainStatus?.lastSyncedAt ?? brainState?.lastSyncedAt
    }

    private var syncState: BrainSyncState {
        brainSyncState(
            statusLoading: statusLoading,
            statusError: statusError,
            saveIndicator: saveIndicator,
            pendingCount: pendingCount,
            unpushedCommitCount: unpushedCommitCount
        )
    }

    private var brainStreaming: Bool {
        projectStore.statusMonitor.isStreaming(BRAIN_WORKSPACE_ID)
    }

    var body: some View {
        Group {
            if stateLoadFailed && brainState == nil {
                errorState
            } else if brainState == nil {
                loadingPlaceholder
            } else if brainState?.exists == false {
                emptyState
            } else {
                conversations
            }
        }
        .task { await loadState() }
        .onChange(of: brainStreaming) { wasStreaming, isStreaming in
            // The agent finished a Brain turn — refresh pending changes so the
            // Save panel reflects any notes it wrote (parity with useBrainChatRefresh).
            if wasStreaming && !isStreaming {
                Task { await loadStatus() }
            }
        }
        .alert("Brain Save Failed", isPresented: Binding(
            get: { saveErrorMessage != nil },
            set: { if !$0 { saveErrorMessage = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            if let saveErrorMessage {
                Text(saveErrorMessage)
            }
        }
    }

    private var conversations: some View {
        ConversationsSection(
            workspace: brainWorkspace,
            store: store,
            navigationPath: $navigationPath,
            labels: .brain,
            onExtraRefresh: loadStatus
        ) {
            BrainDashboardPanel(
                repoUrl: brainState?.repoUrl,
                syncState: syncState,
                pendingCount: pendingCount,
                unpushedCommitCount: unpushedCommitCount,
                lastSyncedAt: lastSyncedAt,
                diff: brainDiff,
                diffLoading: diffLoading,
                diffError: diffError,
                isSaving: saveIndicator == .saving,
                isStreaming: brainStreaming,
                hasUnread: projectStore.statusMonitor.hasUnreadSessions(BRAIN_WORKSPACE_ID),
                onSave: { Task { await save() } }
            )
        }
    }

    private var loadingPlaceholder: some View {
        ListLoadingSkeleton()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .hiveScreenBackground()
            .navigationTitle("Brain")
            .navigationBarTitleDisplayMode(.inline)
    }

    private var errorState: some View {
        ContentUnavailableView {
            Label("Couldn't reach the Brain", systemImage: "exclamationmark.triangle")
        } description: {
            Text("Check your connection and try again.")
        } actions: {
            Button("Retry") { Task { await loadState() } }
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .hiveScreenBackground()
        .navigationTitle("Brain")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var emptyState: some View {
        VStack(spacing: HiveSpacing.md) {
            Image(systemName: "brain")
                .font(.largeTitle)
                .foregroundStyle(WhisperColor.textMuted)
            Text("No Brain connected")
                .font(.headline)
                .foregroundStyle(WhisperColor.text)
            Text("Create or connect a Brain from the desktop app to start capturing notes here.")
                .font(.subheadline)
                .foregroundStyle(WhisperColor.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, HiveSpacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .hiveScreenBackground()
        .navigationTitle("Brain")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func loadState() async {
        do {
            brainState = try await api.fetchBrain()
            stateLoadFailed = false
        } catch is CancellationError {
            // View disappeared.
        } catch {
            stateLoadFailed = true
        }
    }

    private func loadStatus() async {
        guard brainState?.exists != false else { return }
        if !hasLoadedStatusOnce { statusLoading = true }
        if !hasLoadedStatusOnce { diffLoading = true }

        do {
            brainStatus = try await api.fetchBrainStatus()
            statusError = false
        } catch is CancellationError {
            return
        } catch {
            statusError = true
        }
        statusLoading = false

        do {
            brainDiff = try await api.fetchBrainDiff()
            diffError = false
        } catch is CancellationError {
            return
        } catch {
            diffError = true
        }
        diffLoading = false
        hasLoadedStatusOnce = true
    }

    private func save() async {
        savedResetTask?.cancel()
        saveIndicator = .saving
        saveErrorMessage = nil
        do {
            let result = try await api.saveBrain(message: nil)
            // A push can fail with committed:false too (e.g. pushing pre-existing
            // local commits when there is nothing new to commit), so the error
            // flag — not just committed && !pushed — must drive the failure state.
            // Matches the web `handleSave` precedence in BrainView.tsx.
            if result.error != nil || (result.committed && !result.pushed) {
                saveIndicator = .pushFailed
                saveErrorMessage = brainSaveFailureMessage(result: result)
            } else {
                if result.pushed {
                    brainStatus = BrainStatusResponse(
                        files: [],
                        count: 0,
                        upstream: brainStatus?.upstream,
                        lastSyncedAt: result.lastSyncedAt ?? brainStatus?.lastSyncedAt ?? brainState?.lastSyncedAt,
                        unpushedCommitCount: 0
                    )
                    brainDiff = BrainDiffResponse(diff: "", omittedFileCount: 0)
                    if let lastSyncedAt = result.lastSyncedAt, let brainState {
                        self.brainState = BrainState(
                            exists: brainState.exists,
                            repoUrl: brainState.repoUrl,
                            createdAt: brainState.createdAt,
                            lastSyncedAt: lastSyncedAt
                        )
                    }
                }
                saveIndicator = .saved
                savedResetTask = Task {
                    try? await Task.sleep(for: .seconds(3))
                    if !Task.isCancelled { saveIndicator = .idle }
                }
            }
        } catch {
            saveIndicator = .pushFailed
            saveErrorMessage = brainSaveFailureMessage(fallbackErrorDescription: error.localizedDescription)
        }
        await loadStatus()
    }
}
