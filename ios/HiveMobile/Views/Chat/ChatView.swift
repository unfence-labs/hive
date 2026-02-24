import Combine
import SwiftUI

struct ChatView: View {
    let workspace: Workspace
    let store: ConversationStore

    @State private var draft = ""
    @State private var isLoading = true
    @State private var sessions: [SessionMetadata] = []
    @State private var activeSessionId: String?
    @State private var showSessionSheet = false
    @State private var thinkingEnabled = true
    @State private var planModeEnabled = false
    @State private var thinkingLevel: ThinkingLevel = .high
    @State private var selectedModelId: String = ""
    @State private var draftAttachments: [ImageAttachment] = []

    @Environment(ModelCatalog.self) private var modelCatalog
    @Environment(ProjectStore.self) private var projectStore

    private let api = APIClient()
    private let draftStore = ChatDraftStore.shared

    private var lockedProvider: String? {
        if let provider = store.lockedProvider ?? sessions.first(where: { $0.sessionId == activeSessionId })?.lockedProvider {
            return provider
        }
        // Backfill: pre-multi-model sessions have no lockedProvider but were always Claude.
        let session = sessions.first { $0.sessionId == activeSessionId }
        if let session, session.messageCount > 0 {
            return "claude"
        }
        return nil
    }

    private var selectedCapabilities: ProviderCapabilities? {
        modelCatalog.models.first { $0.id == selectedModelId }?.capabilities
    }

    private var pendingToolUseIds: Set<String> {
        Set(store.pendingToolInputs.map(\.toolUseId))
    }

    var body: some View {
        VStack(spacing: 0) {
            if isLoading {
                Spacer()
            } else if store.displayMessages.isEmpty && !store.isStreaming {
                Spacer()
                SessionEmptyState(
                    projectName: workspace.projectName ?? workspace.name,
                    workspaceName: workspace.name,
                    branch: store.branchInfo?.name ?? workspace.branch,
                    defaultBranch: workspace.defaultBranch ?? "main"
                )
                Spacer()
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(spacing: 16) {
                            ForEach(store.displayMessages) { message in
                                MessageBubble(message: message, pendingToolUseIds: pendingToolUseIds)
                                    .id(message.id)
                            }

                            if store.isStreaming {
                                streamingActivityRow
                            }

                            Color.clear
                                .frame(height: 1)
                                .id(bottomAnchorID)
                        }
                        .padding()
                    }
                    .defaultScrollAnchor(.bottom)
                    .scrollDismissesKeyboard(.interactively)
                    .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidShowNotification)) { _ in
                        scrollToBottom(proxy)
                    }
                    .onChange(of: store.displayMessages.count) {
                        scrollToBottom(proxy)
                    }
                    .onChange(of: store.currentText) {
                        scrollToBottom(proxy)
                    }
                }
            }

        }
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 0) {
                let tasksState = store.tasksState
                if !tasksState.tasks.isEmpty {
                    TaskTrackerView(
                        tasks: tasksState.tasks,
                        currentTask: tasksState.currentTask,
                        counts: tasksState.counts,
                        isStreaming: store.isStreaming
                    )
                }
                ChatInputBar(
                    draft: $draft,
                    draftAttachments: draftAttachments,
                    isBusy: store.isBusy,
                    thinkingEnabled: $thinkingEnabled,
                    planModeEnabled: $planModeEnabled,
                    thinkingLevel: $thinkingLevel,
                    models: modelCatalog.models,
                    groupedModels: modelCatalog.groupedByProvider,
                    selectedModelId: selectedModelId,
                    defaultModelId: modelCatalog.defaultModelId,
                    lockedProvider: lockedProvider,
                    capabilities: selectedCapabilities,
                    onModelSelect: { selectedModelId = $0 },
                    onDraftAttachmentsChange: { draftAttachments = $0 },
                    onSend: sendMessage,
                    onStop: { Task { await store.send?(.stop(sessionId: activeSessionId)) } }
                )
                .padding(.horizontal, 12)
                .padding(.bottom, 4)
            }
        }
        .toolbarBackground(.black, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 2) {
                    Text(workspace.projectName ?? workspace.name)
                        .font(.headline)
                    Text("\(workspace.name) · \(store.branchInfo?.name ?? workspace.branch)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showSessionSheet = true
                } label: {
                    if let projectId = workspace.projectId {
                        ProjectAvatar(
                            id: projectId,
                            name: workspace.projectName ?? workspace.name,
                            hasFavicon: workspace.hasFavicon
                        )
                    } else {
                        Image(systemName: "text.bubble")
                    }
                }
            }
        }
        .sheet(isPresented: $showSessionSheet) {
            SessionSheet(
                sessions: sessions,
                activeSessionId: activeSessionId,
                onSelect: { switchSession($0) },
                onCreate: { createSession() },
                onDelete: { deleteSession($0) }
            )
        }
        .sheet(isPresented: Binding(
            get: { !store.pendingToolInputs.isEmpty },
            set: { if !$0 { store.clearPendingToolInputs() } }
        )) {
            ToolInputSheet(pendingInputs: store.pendingToolInputs) { pending, result in
                respondToTool(pending: pending, result: result)
            }
        }
        .task { await setup() }
        .onChange(of: modelCatalog.isLoaded) {
            if selectedModelId.isEmpty, !modelCatalog.defaultModelId.isEmpty {
                selectedModelId = modelCatalog.defaultModelId
            }
        }
        .onChange(of: lockedProvider) { _, newProvider in
            guard let newProvider, !selectedModelId.isEmpty else { return }
            let currentProvider = selectedModelId.split(separator: ":").first.map(String.init) ?? ""
            if currentProvider != newProvider {
                let fallback = modelCatalog.models.first { $0.provider == newProvider && $0.isDefault == true }
                    ?? modelCatalog.models.first { $0.provider == newProvider }
                if let fallback { selectedModelId = fallback.id }
            }
        }
        .onDisappear {
            saveCurrentDraft()
            store.onTurnCompleted = nil
        }
    }

    // MARK: - Streaming Activity

    private var streamingActivityRow: some View {
        TimelineView(.periodic(from: .now, by: 0.1)) { timeline in
            HStack(spacing: 6) {
                AgentActivityIndicator(dotSize: 3, spacing: 1.5)
                Text(formatStreamingElapsed(at: timeline.date))
                    .font(WhisperFont.mono(10))
                    .foregroundStyle(WhisperColor.textMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, 2)
            .id("streaming-indicator")
        }
    }

    // MARK: - Setup

    private func setup() async {
        projectStore.statusMonitor.clearCompleted(workspace.id)

        // Wire post-turn re-sync: after done/cancelled, re-fetch messages from REST
        // so client-generated UUIDs are replaced with backend-assigned IDs.
        store.onTurnCompleted = { [weak store, api, workspace] sessionId in
            Task { @MainActor [weak store] in
                guard let store else { return }
                // Keep A streaming while B is open: only re-sync the visible session.
                guard store.sessionId == sessionId else { return }

                let requestToken = store.beginHistoryRequest(for: sessionId)
                do {
                    let msgs = try await api.fetchMessages(
                        workspaceId: workspace.id,
                        sessionId: sessionId
                    )
                    guard let store else { return }
                    guard store.sessionId == sessionId else { return }
                    guard store.historyToken(for: sessionId) == requestToken else { return }
                    if store.sessionStreams[sessionId]?.isStreaming != true {
                        store.messages = msgs
                    }
                } catch {
                    // Best-effort — streamed messages remain as fallback
                }
            }
        }

        await loadSessions()
        let initialSessionId = resolveInitialSessionId()
        activeSessionId = initialSessionId
        store.setFocusedSessionId(initialSessionId)

        if let sessionId = activeSessionId {
            restoreDraft(for: sessionId)
        }

        if selectedModelId.isEmpty {
            selectedModelId = modelCatalog.defaultModelId
        }

        await loadMessages()
    }

    private func resolveInitialSessionId() -> String? {
        let knownSessionIds = Set(sessions.map(\.sessionId))

        // Keep the currently focused store session whenever possible, so leaving
        // and returning to chat doesn't drop in-progress streaming/thinking state.
        if let cachedSessionId = store.sessionId {
            if knownSessionIds.isEmpty || knownSessionIds.contains(cachedSessionId) ||
                store.sessionStreams[cachedSessionId] != nil {
                return cachedSessionId
            }
        }

        if let workspaceSessionId = workspace.activeSessionId, knownSessionIds.contains(workspaceSessionId) {
            return workspaceSessionId
        }

        return sessions.first?.sessionId
    }

    private func loadSessions() async {
        do {
            sessions = try await api.fetchSessions(workspaceId: workspace.id)
        } catch is CancellationError {
            // View disappeared
        } catch {
            // Non-critical — chat still works without session list
        }
    }

    private func loadMessages() async {
        guard let sessionId = activeSessionId else {
            isLoading = false
            return
        }
        store.setFocusedSessionId(sessionId)
        let requestToken = store.beginHistoryRequest(for: sessionId)
        do {
            let msgs = try await api.fetchMessages(
                workspaceId: workspace.id,
                sessionId: sessionId
            )
            // If the user switched session while this request was in-flight, ignore it.
            guard activeSessionId == sessionId else {
                isLoading = false
                return
            }
            // Skip if a newer event (WS history, send, session switch) arrived while
            // this REST call was in-flight — their data is more authoritative.
            guard store.historyToken(for: sessionId) == requestToken else {
                isLoading = false
                return
            }
            // Don't overwrite messages while streaming — the active stream state
            // would be lost (matches the guard in ConversationStore's .history handler).
            if store.sessionStreams[sessionId]?.isStreaming != true {
                store.messages = msgs
            }
        } catch is CancellationError {
            // View disappeared
        } catch {
            // Fall through to WS history
        }
        isLoading = false
    }

    // MARK: - Sessions

    private func switchSession(_ sessionId: String) {
        guard sessionId != activeSessionId else { return }
        saveCurrentDraft()
        activeSessionId = sessionId
        restoreDraft(for: sessionId)
        store.prepareSessionSwitch(sessionId)
        isLoading = true
        Task {
            await store.send?(.switchSession(sessionId: sessionId))
            await loadMessages()
        }
    }

    private func createSession() {
        Task {
            guard let session = try? await api.createSession(workspaceId: workspace.id) else { return }
            sessions.append(session)
            switchSession(session.sessionId)
        }
    }

    private func deleteSession(_ sessionId: String) {
        Task {
            guard (try? await api.deleteSession(workspaceId: workspace.id, sessionId: sessionId)) != nil else { return }
            draftStore.remove(workspaceId: workspace.id, sessionId: sessionId)
            sessions.removeAll { $0.sessionId == sessionId }
            if sessionId == activeSessionId, let first = sessions.first {
                switchSession(first.sessionId)
            }
        }
    }

    // MARK: - Send

    private func sendMessage(images: [ImageAttachment]) {
        let content = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty || !images.isEmpty else { return }

        let targetSessionId = activeSessionId
        // Snapshot draft so we can restore on failure
        let savedDraft = draft
        let savedAttachments = draftAttachments
        let savedDraftState = ChatDraftStore.Draft(
            text: savedDraft,
            thinkingEnabled: thinkingEnabled,
            planModeEnabled: planModeEnabled,
            thinkingLevel: thinkingLevel,
            selectedModelId: selectedModelId.isEmpty ? nil : selectedModelId,
            attachments: savedAttachments.map(ChatDraftStore.Attachment.init)
        )
        draft = ""
        draftAttachments = []

        let caps = selectedCapabilities
        let supportsThinkingToggle = caps?.thinking == .boolean(true)
        let supportsThinkingLevels = caps?.thinking == .levels
        let supportsPlanMode = caps?.planMode ?? true

        let options = MessageOptions(
            planMode: supportsPlanMode ? (planModeEnabled ? true : nil) : nil,
            thinkingEnabled: supportsThinkingToggle ? (thinkingEnabled ? true : nil) : nil,
            model: selectedModelId.isEmpty ? nil : selectedModelId,
            thinkingLevel: supportsThinkingLevels ? thinkingLevel : nil
        )

        Task {
            let sent = await store.send?(.userMessage(
                content: content,
                images: images.isEmpty ? nil : images,
                options: options,
                sessionId: targetSessionId
            )) ?? false

            if sent {
                // Bump history token so any in-flight REST fetch won't overwrite the
                // user_message echo that the backend is about to broadcast.
                store.bumpHistoryToken(for: targetSessionId)
            } else {
                // Persist draft for the originating session, even if the user switched away.
                if let targetSessionId {
                    draftStore.save(
                        workspaceId: workspace.id,
                        sessionId: targetSessionId,
                        draft: savedDraftState
                    )
                }
                // Restore inline only if the user is still on the same session.
                guard activeSessionId == targetSessionId else { return }
                draft = savedDraft
                draftAttachments = savedAttachments
                store.messages.append(ChatMessage(
                    id: UUID().uuidString, sessionId: "", role: .assistant,
                    content: "Message not sent: disconnected from server.",
                    images: nil, toolCalls: nil, thinkingContent: nil,
                    timestamp: ConversationStore.timestamp(),
                    cancelled: nil, durationMs: nil
                ))
            }
        }
    }

    private func respondToTool(pending: PendingToolInput, result: ToolInputResult) {
        Task {
            let sent = await store.send?(.toolInputResponse(
                requestId: pending.requestId,
                toolName: pending.toolName,
                result: result,
                sessionId: pending.sessionId
            )) ?? false

            if sent {
                store.clearPendingToolInputs()
                store.bumpHistoryToken(for: pending.sessionId)
            } else if pending.sessionId == activeSessionId {
                store.messages.append(ChatMessage(
                    id: UUID().uuidString, sessionId: "", role: .assistant,
                    content: "Tool response not sent: disconnected from server.",
                    images: nil, toolCalls: nil, thinkingContent: nil,
                    timestamp: ConversationStore.timestamp(),
                    cancelled: nil, durationMs: nil
                ))
            }
        }
    }

    // MARK: - Draft Persistence

    private func saveCurrentDraft() {
        guard let sessionId = activeSessionId else { return }
        draftStore.save(
            workspaceId: workspace.id,
            sessionId: sessionId,
            draft: .init(
                text: draft,
                thinkingEnabled: thinkingEnabled,
                planModeEnabled: planModeEnabled,
                thinkingLevel: thinkingLevel,
                selectedModelId: selectedModelId.isEmpty ? nil : selectedModelId,
                attachments: draftAttachments.map(ChatDraftStore.Attachment.init)
            )
        )
    }

    private func restoreDraft(for sessionId: String) {
        if let saved = draftStore.restore(workspaceId: workspace.id, sessionId: sessionId) {
            draft = saved.text
            thinkingEnabled = saved.thinkingEnabled
            planModeEnabled = saved.planModeEnabled
            thinkingLevel = saved.thinkingLevel
            if let modelId = saved.selectedModelId {
                selectedModelId = modelId
            }
            draftAttachments = saved.attachments.map(ImageAttachment.init)
        } else {
            draft = ""
            thinkingEnabled = true
            planModeEnabled = false
            thinkingLevel = .high
            selectedModelId = modelCatalog.defaultModelId
            draftAttachments = []
        }
    }

    private static let bottomAnchorID = "chat-bottom-anchor"
    private var bottomAnchorID: String { Self.bottomAnchorID }

    private func scrollToBottom(_ proxy: ScrollViewProxy, animated: Bool = true) {
        if animated {
            withAnimation(.easeOut(duration: 0.15)) {
                proxy.scrollTo(bottomAnchorID, anchor: .bottom)
            }
        } else {
            proxy.scrollTo(bottomAnchorID, anchor: .bottom)
        }
    }

    private func formatStreamingElapsed(at date: Date) -> String {
        guard let startedAt = store.streamingStartedAt else {
            return "0.0s"
        }

        let elapsedMs = max(0, Int(date.timeIntervalSince(startedAt) * 1000))
        let totalSec = Double(elapsedMs) / 1000
        let min = Int(totalSec / 60)
        let sec = totalSec.truncatingRemainder(dividingBy: 60)
        let secFormatted = sec.formatted(.number.precision(.fractionLength(1)))
        let secLabel = min > 0 && sec < 10 ? "0\(secFormatted)" : secFormatted

        return min > 0 ? "\(min)m \(secLabel)s" : "\(secFormatted)s"
    }
}

#Preview {
    NavigationStack {
        ChatView(
            workspace: Workspace(
                id: "ws-1", name: "san-antonio-v1", branch: "0xlny/ios-app",
                status: .idle, createdAt: "", activeSessionId: "sess-1",
                projectName: "hive", defaultBranch: "main"
            ),
            store: ConversationStore()
        )
    }
    .environment(ModelCatalog())
    .environment(ProjectStore(storeCache: ConversationStoreCache()))
    .preferredColorScheme(.dark)
}

private extension ChatDraftStore.Attachment {
    init(_ image: ImageAttachment) {
        self.init(name: image.name, mediaType: image.mediaType, dataUrl: image.dataUrl)
    }
}

private extension ImageAttachment {
    init(_ draftAttachment: ChatDraftStore.Attachment) {
        self.init(
            name: draftAttachment.name,
            mediaType: draftAttachment.mediaType,
            dataUrl: draftAttachment.dataUrl
        )
    }
}
