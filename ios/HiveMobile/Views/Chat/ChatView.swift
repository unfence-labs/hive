import Combine
import SwiftUI

struct ChatView: View {
    let workspace: Workspace
    let session: SessionMetadata
    let store: ConversationStore

    @State private var draft = ""
    @State private var isLoading = true
    @State private var planModeEnabled = false
    @State private var thinkingLevel: ThinkingLevel = .high
    @State private var fastModeEnabled = false
    @State private var selectedModelId: String = ""
    @State private var draftAttachments: [ImageAttachment] = []
    @State private var renderedStreamingText = ""
    @State private var renderedStreamingThinking = ""
    @State private var pendingStreamingText = ""
    @State private var pendingStreamingThinking = ""
    @State private var lastStreamingRenderAt = Date.distantPast
    @State private var streamingRenderTask: Task<Void, Never>?
    @State private var isNearScrollBottom = true

    @Environment(ModelCatalog.self) private var modelCatalog
    @Environment(ProjectStore.self) private var projectStore

    private let api = APIClient()
    private let draftStore = ChatDraftStore.shared

    private var lockedProvider: String? {
        if let provider = store.lockedProvider ?? session.lockedProvider {
            return provider
        }
        // Backfill: pre-multi-model sessions have no lockedProvider but were always Claude.
        if session.messageCount > 0 {
            return "claude"
        }
        return nil
    }

    private var selectedModel: ModelCatalogEntry? {
        modelCatalog.models.first { $0.id == selectedModelId }
    }

    /// Resolve the model to open this conversation on. Prefer the session's
    /// locked provider's default model so an existing chat (e.g. Opus) doesn't
    /// open on the global default, which may be a different provider (e.g. Codex)
    /// after the in-memory draft is gone (app relaunch). Mirrors the web's
    /// `useModels(lockedProvider)` seeding.
    private func initialModelId() -> String {
        if let lastModelId = session.lastRunOptions?.model,
           let match = modelCatalog.models.first(where: {
               $0.id == lastModelId && (lockedProvider == nil || $0.provider == lockedProvider)
           }) {
            return match.id
        }
        if let provider = lockedProvider {
            if let match = modelCatalog.models.first(where: { $0.provider == provider && $0.isDefault == true })
                ?? modelCatalog.models.first(where: { $0.provider == provider }) {
                return match.id
            }
        }
        return modelCatalog.defaultModelId
    }

    private func applySessionRunOptions() {
        selectedModelId = initialModelId()
        planModeEnabled = session.lastRunOptions?.planMode ?? false
        thinkingLevel = session.lastRunOptions?.thinkingLevel ?? .high
        fastModeEnabled = session.lastRunOptions?.fastMode ?? false
    }

    private var selectedCapabilities: ProviderCapabilities? {
        selectedModel?.capabilities
    }

    private var contextUsage: ContextUsageData {
        ContextUsageData.derive(from: store.messages, contextWindow: selectedModel?.contextWindow)
    }

    private var navigationTitle: String {
        workspace.projectName ?? workspace.name
    }

    private var navigationSubtitle: String {
        "\(workspace.name) · \(store.branchInfo?.name ?? workspace.branch)"
    }

    private var pendingToolUseIds: Set<String> {
        Set(store.pendingToolInputs.map(\.toolUseId))
    }

    private var dismissedToolCallIds: Set<String> {
        var ids = Set<String>()
        let msgs = store.messages
        for i in 0..<(msgs.count - 1) {
            let msg = msgs[i]
            let next = msgs[i + 1]
            if msg.role == .assistant, next.role == .user, next.content == "Question dismissed." {
                for tc in msg.toolCalls ?? [] where tc.name == "AskUserQuestion" {
                    ids.insert(tc.id)
                }
            }
        }
        return ids
    }

    var body: some View {
        VStack(spacing: 0) {
            if isLoading {
                Spacer()
            } else if store.messages.isEmpty && streamingMessage == nil && !store.isStreaming {
                Spacer()
                if isBrainWorkspaceId(workspace.id) {
                    BrainSessionEmptyState()
                } else {
                    SessionEmptyState(
                        projectName: workspace.projectName ?? workspace.name,
                        workspaceName: workspace.name,
                        branch: store.branchInfo?.name ?? workspace.branch,
                        defaultBranch: workspace.defaultBranch ?? "main"
                    )
                }
                Spacer()
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 16) {
                            ForEach(store.messages) { message in
                                if !(message.role == .user && message.content == "Question dismissed.") {
                                    MessageBubble(message: message, pendingToolUseIds: pendingToolUseIds, dismissedToolCallIds: dismissedToolCallIds)
                                        .id(message.id)
                                }
                            }

                            if let message = streamingMessage {
                                MessageBubble(message: message, pendingToolUseIds: pendingToolUseIds, dismissedToolCallIds: dismissedToolCallIds)
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
                    .onScrollGeometryChange(for: Bool.self) { geometry in
                        geometry.contentSize.height - geometry.visibleRect.maxY < Self.scrollBottomTolerance
                    } action: { _, isNearBottom in
                        isNearScrollBottom = isNearBottom
                    }
                    .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidShowNotification)) { _ in
                        scrollToBottomIfNeeded(proxy)
                    }
                    .onChange(of: store.messages.count) {
                        scrollToBottomIfNeeded(proxy)
                    }
                    .onChange(of: store.currentText) {
                        scheduleStreamingRender(text: store.currentText)
                    }
                    .onChange(of: renderedStreamingText) {
                        scrollToBottomIfNeeded(proxy)
                    }
                    .onChange(of: store.currentThinking) {
                        scheduleStreamingRender(thinking: store.currentThinking)
                    }
                    .onChange(of: renderedStreamingThinking) {
                        scrollToBottomIfNeeded(proxy)
                    }
                    .onChange(of: store.activeToolCalls.count) {
                        scrollToBottomIfNeeded(proxy)
                    }
                    .onChange(of: store.activeAgentActivities.count) {
                        scrollToBottomIfNeeded(proxy)
                    }
                    .onChange(of: store.isStreaming) { _, isStreaming in
                        if isStreaming {
                            scrollToBottomIfNeeded(proxy)
                        }
                    }
                }
            }

        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .hiveScreenBackground()
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: HiveSpacing.sm) {
                let tasksState = store.tasksState
                let goal = store.goalState
                let agents = store.backgroundAgents
                if goal != nil || !tasksState.tasks.isEmpty || !agents.agents.isEmpty {
                    TaskTrackerView(
                        goal: goal,
                        tasks: tasksState.tasks,
                        currentTask: tasksState.currentTask,
                        counts: tasksState.counts,
                        trackerStatus: tasksState.trackerStatus,
                        backgroundAgents: agents.agents,
                        backgroundRunningCount: agents.runningCount,
                        isStreaming: store.isStreaming
                    )
                }
                ChatInputBar(
                    draft: $draft,
                    draftAttachments: draftAttachments,
                    isBusy: store.isBusy,
                    planModeEnabled: $planModeEnabled,
                    thinkingLevel: $thinkingLevel,
                    fastModeEnabled: $fastModeEnabled,
                    models: modelCatalog.models,
                    groupedModels: modelCatalog.groupedByProvider,
                    selectedModelId: selectedModelId,
                    defaultModelId: modelCatalog.defaultModelId,
                    lockedProvider: lockedProvider,
                    capabilities: selectedCapabilities,
                    onModelSelect: { selectedModelId = $0 },
                    contextUsage: contextUsage,
                    onDraftAttachmentsChange: { draftAttachments = $0 },
                    onSend: sendMessage,
                    onStop: { Task { _ = await store.send?(.stop(sessionId: session.sessionId)) } }
                )
                .padding(.horizontal, 12)
            }
            .padding(.top, HiveSpacing.sm)
            .padding(.bottom, HiveSpacing.sm)
        }
        .toolbarBackground(WhisperColor.appBackground, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .navigationTitle(navigationTitle)
        .navigationSubtitle(Text(navigationSubtitle))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
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
                selectedModelId = initialModelId()
            }
        }
        .onChange(of: store.agentPlanMode) { _, active in
            if let active {
                planModeEnabled = active
            }
        }
        .onChange(of: store.isStreaming) { _, isStreaming in
            if isStreaming {
                pendingStreamingText = store.currentText
                pendingStreamingThinking = store.currentThinking
                applyPendingStreamingRender()
            } else {
                resetStreamingRender()
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
            streamingRenderTask?.cancel()
            saveCurrentDraft()
            store.onTurnCompleted = nil
            if projectStore.statusMonitor.viewingWorkspaceId == workspace.id,
               projectStore.statusMonitor.viewingSessionId == session.sessionId {
                projectStore.statusMonitor.viewingSessionId = nil
            }
        }
    }

    // MARK: - Streaming Activity

    private static let streamingRenderInterval: TimeInterval = 0.05
    private static let scrollBottomTolerance: CGFloat = 96

    private var streamingMessage: ChatMessage? {
        guard store.isStreaming else { return nil }
        let hasContent = !renderedStreamingText.isEmpty || !renderedStreamingThinking.isEmpty
            || !store.activeToolCalls.isEmpty || !store.activeAgentActivities.isEmpty
        guard hasContent else { return nil }

        return ChatMessage(
            id: "streaming",
            sessionId: store.sessionId ?? "",
            role: .assistant,
            content: renderedStreamingText,
            images: nil,
            toolCalls: store.activeToolCalls.isEmpty ? nil : store.activeToolCalls,
            agentActivities: store.activeAgentActivities.isEmpty ? nil : store.activeAgentActivities,
            thinkingContent: renderedStreamingThinking.isEmpty ? nil : renderedStreamingThinking,
            timestamp: ConversationStore.timestamp(),
            cancelled: nil,
            durationMs: nil
        )
    }

    private func scheduleStreamingRender(text: String? = nil, thinking: String? = nil) {
        if let text {
            pendingStreamingText = text
        }
        if let thinking {
            pendingStreamingThinking = thinking
        }

        let elapsed = Date().timeIntervalSince(lastStreamingRenderAt)
        if elapsed >= Self.streamingRenderInterval {
            streamingRenderTask?.cancel()
            streamingRenderTask = nil
            applyPendingStreamingRender()
            return
        }

        guard streamingRenderTask == nil else { return }

        let delay = Self.streamingRenderInterval - elapsed
        let milliseconds = Int64(max(1, (delay * 1000).rounded(.up)))
        streamingRenderTask = Task {
            do {
                try await Task.sleep(for: .milliseconds(milliseconds))
            } catch {
                return
            }

            await MainActor.run {
                applyPendingStreamingRender()
                streamingRenderTask = nil
            }
        }
    }

    private func applyPendingStreamingRender() {
        lastStreamingRenderAt = Date()
        renderedStreamingText = pendingStreamingText
        renderedStreamingThinking = pendingStreamingThinking
    }

    private func resetStreamingRender() {
        streamingRenderTask?.cancel()
        streamingRenderTask = nil
        pendingStreamingText = ""
        pendingStreamingThinking = ""
        renderedStreamingText = ""
        renderedStreamingThinking = ""
        lastStreamingRenderAt = .distantPast
    }

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
        projectStore.statusMonitor.viewingWorkspaceId = workspace.id
        projectStore.statusMonitor.viewingSessionId = session.sessionId
        projectStore.statusMonitor.clearCompleted(workspace.id)
        projectStore.statusMonitor.clearUnread(workspaceId: workspace.id, sessionId: session.sessionId)
        let selectedSessionId = session.sessionId

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
                    guard store.sessionId == sessionId else { return }
                    guard store.historyToken(for: sessionId) == requestToken else { return }
                    store.messages = msgs
                } catch {
                    // Best-effort — streamed messages remain as fallback
                }
            }
        }

        if store.sessionId == selectedSessionId {
            store.setFocusedSessionId(selectedSessionId)
            if projectStore.statusMonitor.isStreaming(workspaceId: workspace.id, sessionId: selectedSessionId) {
                _ = await store.send?(.switchSession(sessionId: selectedSessionId))
            }
        } else {
            store.prepareSessionSwitch(selectedSessionId)
            _ = await store.send?(.switchSession(sessionId: selectedSessionId))
        }
        restoreDraft(for: selectedSessionId)

        if selectedModelId.isEmpty {
            selectedModelId = initialModelId()
        }

        await loadMessages()
    }

    private func loadMessages() async {
        let sessionId = session.sessionId
        store.setFocusedSessionId(sessionId)
        let requestToken = store.beginHistoryRequest(for: sessionId)
        do {
            let msgs = try await api.fetchMessages(
                workspaceId: workspace.id,
                sessionId: sessionId
            )
            // If another chat view took focus while this request was in-flight, ignore it.
            guard store.sessionId == sessionId else {
                isLoading = false
                return
            }
            // Skip if a newer event (WS history, send, session switch) arrived while
            // this REST call was in-flight — their data is more authoritative.
            guard store.historyToken(for: sessionId) == requestToken else {
                isLoading = false
                return
            }
            // History contains only finalized turns; streaming content lives
            // in sessionStreams and is appended by displayMessages.
            store.messages = msgs
        } catch is CancellationError {
            // View disappeared
        } catch {
            // Fall through to WS history
        }
        isLoading = false
    }

    // MARK: - Send

    private func sendMessage(images: [ImageAttachment]) {
        let content = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty || !images.isEmpty else { return }

        let targetSessionId = session.sessionId
        // Snapshot draft so we can restore on failure
        let savedDraft = draft
        let savedAttachments = draftAttachments
        let savedDraftState = ChatDraftStore.Draft(
            text: savedDraft,
            attachments: savedAttachments.map(ChatDraftStore.Attachment.init)
        )
        draft = ""
        draftAttachments = []

        let caps = selectedCapabilities
        let levels = caps?.thinkingLevels ?? []
        let supportsThinking = !levels.isEmpty
        let supportsPlanMode = caps?.planMode ?? true
        // Fast mode is Opus-only; never send it for a model that can't use it.
        let supportsFastMode = selectedModel?.supportsFastMode ?? false

        let effectiveThinking: ThinkingLevel = {
            guard supportsThinking else { return thinkingLevel }
            if levels.contains(thinkingLevel) { return thinkingLevel }
            if levels.contains(.high) { return .high }
            return levels[0]
        }()

        let options = MessageOptions(
            planMode: supportsPlanMode ? (planModeEnabled ? true : nil) : nil,
            model: selectedModelId.isEmpty ? nil : selectedModelId,
            thinkingLevel: supportsThinking ? effectiveThinking : nil,
            fastMode: (supportsFastMode && fastModeEnabled) ? true : nil
        )

        Task {
            let sent = await store.send?(.userMessage(
                content: content,
                images: images.isEmpty ? nil : images,
                fileMentions: nil,
                options: options,
                sessionId: targetSessionId
            )) ?? false

            if sent {
                // Bump history token so any in-flight REST fetch won't overwrite the
                // user_message echo that the backend is about to broadcast.
                store.bumpHistoryToken(for: targetSessionId)
            } else {
                // Persist draft for the originating session, even if the user switched away.
                draftStore.save(
                    workspaceId: workspace.id,
                    sessionId: targetSessionId,
                    draft: savedDraftState
                )
                // Restore inline only if the user is still on the same session.
                guard store.sessionId == targetSessionId else { return }
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
                // Auto-disable plan mode toggle on approve
                if pending.toolName == "ExitPlanMode", case .approve = result {
                    planModeEnabled = false
                    store.setAgentPlanMode(false, for: pending.sessionId)
                }
            } else if pending.sessionId == session.sessionId {
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
        draftStore.save(
            workspaceId: workspace.id,
            sessionId: session.sessionId,
            draft: .init(
                text: draft,
                attachments: draftAttachments.map(ChatDraftStore.Attachment.init)
            )
        )
    }

    private func restoreDraft(for sessionId: String) {
        if let saved = draftStore.restore(workspaceId: workspace.id, sessionId: sessionId) {
            draft = saved.text
            draftAttachments = saved.attachments.map(ImageAttachment.init)
        } else {
            draft = ""
            draftAttachments = []
        }
        applySessionRunOptions()
    }

    private static let bottomAnchorID = "chat-bottom-anchor"
    private var bottomAnchorID: String { Self.bottomAnchorID }

    private func scrollToBottomIfNeeded(_ proxy: ScrollViewProxy) {
        guard isNearScrollBottom else { return }
        proxy.scrollTo(bottomAnchorID, anchor: .bottom)
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
            session: SessionMetadata(
                sessionId: "sess-1",
                providerSessionId: nil,
                claudeSessionId: nil,
                workspaceId: "ws-1",
                title: "Fix iOS navigation",
                createdAt: "2026-02-18T08:00:00.000Z",
                updatedAt: "2026-02-18T10:00:00.000Z",
                messageCount: 5,
                lockedProvider: "codex"
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
