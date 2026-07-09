import Combine
import SwiftUI

struct ChatView: View {
    let workspace: Workspace
    let session: SessionMetadata
    let store: ConversationStore

    @State private var draft = ""
    @State private var isLoading = true
    @State private var showSkeleton = false
    @State private var planModeEnabled = false
    @State private var thinkingLevel: ThinkingLevel = .high
    @State private var fastModeEnabled = false
    @State private var selectedModelId: String = ""
    @State private var draftAttachments: [ImageAttachment] = []
    @State private var isNearScrollBottom = true
    @State private var isTouchingTranscript = false
    @State private var showQuestionSheet = false
    @State private var findOpen = false
    @State private var findQuery = ""
    @State private var findModel = ConversationFindModel()
    @State private var transcriptScroller = TranscriptScroller()
    @FocusState private var findFieldFocused: Bool

    // Composer autocomplete (#file, /command, @agent)
    @State private var activeAutocomplete: ComposerAutocomplete.Active?
    @State private var draftFileMentions: [FileMention] = []
    @State private var completionFiles: [String]?
    @State private var preparedFileCandidates: [ComposerAutocomplete.FileCandidate]?
    @State private var completionItems: [CompletionItem]?
    @State private var completionItemsProvider: String?

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

    var body: some View {
        VStack(spacing: 0) {
            if isLoading {
                if showSkeleton {
                    ConversationLoadingSkeleton()
                } else {
                    Spacer()
                }
            } else if store.messages.isEmpty && streamingMessage == nil && !store.isStreaming {
                Spacer()
                if store.historyLoadFailed(for: session.sessionId) {
                    VStack(spacing: 12) {
                        Text("Couldn't load this conversation")
                            .font(WhisperFont.scaled(14))
                            .foregroundStyle(WhisperColor.textSecondary)
                        Button {
                            Task { await loadMessages() }
                        } label: {
                            Label("Retry", systemImage: "arrow.clockwise")
                                .font(WhisperFont.scaled(13).weight(.semibold))
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(WhisperColor.danger)
                    }
                } else if isBrainWorkspaceId(workspace.id) {
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
                    List {
                        ForEach(store.messages) { message in
                            if !(message.role == .user && message.content == "Question dismissed.") {
                                MessageBubble(
                                    message: message,
                                    pendingToolUseIds: pendingToolUseIds,
                                    dismissedToolCallIds: store.dismissedToolCallIds,
                                    sendState: store.sendState(for: message.id),
                                    findHighlight: findOpen ? findModel.highlight(for: message.id) : nil,
                                    onRetrySend: { Task { await store.retryOptimisticSend(message.id) } },
                                    onDiscardSend: { store.discardOptimisticSend(message.id) }
                                )
                                .equatable()
                                .id(message.id)
                                .chatTranscriptRow()
                            }
                        }

                        if let message = streamingMessage {
                            MessageBubble(
                                message: message,
                                pendingToolUseIds: pendingToolUseIds,
                                dismissedToolCallIds: store.dismissedToolCallIds
                            )
                            .equatable()
                            .id(message.id)
                            .chatTranscriptRow()
                        }

                        if store.isStreaming {
                            streamingActivityRow
                                .chatTranscriptRow()
                        }

                        Color.clear
                            .frame(height: 1)
                            .id(bottomAnchorID)
                            .chatTranscriptAnchorRow()
                    }
                    .listStyle(.plain)
                    .environment(\.defaultMinListRowHeight, 0)
                    .scrollContentBackground(.hidden)
                    .defaultScrollAnchor(.bottom, for: .initialOffset)
                    .defaultScrollAnchor(.topLeading, for: .alignment)
                    .scrollDismissesKeyboard(.interactively)
                    .onAppear {
                        scrollToBottom(proxy, force: true)
                    }
                    .onScrollGeometryChange(for: Bool.self) { geometry in
                        geometry.contentSize.height - geometry.visibleRect.maxY < Self.scrollBottomTolerance
                    } action: { _, isNearBottom in
                        isNearScrollBottom = isNearBottom
                    }
                    .background(
                        // A finger on the transcript pauses auto-scroll AND the
                        // streaming delta flush: any transcript movement (our
                        // scrollTo or the List's own bottom-anchoring on content
                        // growth) cancels the long-press copy interaction while
                        // streaming. SwiftUI gestures on a List never fire for
                        // stationary touches, so this observes at the UIKit level.
                        TranscriptTouchProbe { touching in
                            isTouchingTranscript = touching
                            store.setStreamingUIHold(touching)
                            if touching { transcriptScroller.cancelScroll() }
                        } onCollectionView: { collectionView in
                            transcriptScroller.collectionView = collectionView
                        }
                    )
                    .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidShowNotification)) { _ in
                        scrollToBottomIfNeeded(proxy)
                    }
                    .onChange(of: store.messages.count) {
                        scrollToBottomIfNeeded(proxy)
                    }
                    .onChange(of: store.currentText) {
                        scrollToBottomIfNeeded(proxy)
                    }
                    .onChange(of: store.currentThinking) {
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
                    .onChange(of: findModel.activeMatch) { _, match in
                        guard findOpen, let match else { return }
                        scrollToFindMatch(match, proxy: proxy)
                    }
                }
            }

        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .hiveScreenBackground()
        .overlay(alignment: .bottomTrailing) {
            if findOpen {
                ConversationFindNavigator(
                    enabled: findModel.matchCount > 0,
                    onPrevious: { findModel.previous() },
                    onNext: { findModel.next() }
                )
                .padding(.trailing, HiveSpacing.lg)
                .padding(.bottom, HiveSpacing.lg)
                .transition(.scale(scale: 0.85, anchor: .bottomTrailing).combined(with: .opacity))
            }
        }
        .overlay(alignment: .bottomLeading) {
            if findOpen, !findQuery.isEmpty {
                ConversationFindCounter(
                    matchCount: findModel.matchCount,
                    displayIndex: findModel.displayIndex,
                    noResults: findModel.query == findQuery && findModel.matchCount == 0
                )
                .padding(.leading, HiveSpacing.lg)
                .padding(.bottom, HiveSpacing.lg)
                .transition(.scale(scale: 0.85, anchor: .bottomLeading).combined(with: .opacity))
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            if findOpen {
                ConversationFindBar(
                    query: $findQuery,
                    focused: $findFieldFocused,
                    onSubmit: { findModel.update(messages: findableMessages, query: findQuery) },
                    onClose: closeFind
                )
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if !findOpen {
                composerStack
            }
        }
        .toolbarBackground(WhisperColor.appBackground, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .navigationTitle(navigationTitle)
        .navigationSubtitle(Text(navigationSubtitle))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(action: openFind) {
                    Image(systemName: "magnifyingglass")
                }
                .accessibilityLabel("Search in conversation")
                .disabled(isLoading || store.messages.isEmpty)
            }
        }
        .toolbar(findOpen ? .hidden : .automatic, for: .navigationBar)
        .sensoryFeedback(.success, trigger: store.visibleCompletionCount)
        .sheet(isPresented: $showQuestionSheet) {
            ToolInputSheet(pendingInputs: store.pendingToolInputs) { pending, result in
                respondToTool(pending: pending, result: result)
            }
        }
        .onChange(of: store.pendingToolInputs.map(\.requestId)) { oldIds, newIds in
            // A newly-arrived question auto-presents the sheet; answering or the
            // turn ending clears the questions and closes it. Dismissing only
            // hides the sheet — the questions persist and surface as a chip.
            if !Set(newIds).subtracting(oldIds).isEmpty {
                showQuestionSheet = true
            } else if newIds.isEmpty {
                showQuestionSheet = false
            }
        }
        .task { await setup() }
        .task { await modelCatalog.loadIfNeeded() }
        .task(id: findQuery) {
            guard findOpen else { return }
            try? await Task.sleep(for: .milliseconds(200))
            if !Task.isCancelled {
                findModel.update(messages: findableMessages, query: findQuery)
            }
        }
        .onChange(of: store.messages) {
            if findOpen, !findModel.query.isEmpty {
                findModel.update(messages: findableMessages, query: findModel.query)
            }
        }
        .task(id: isLoading) {
            guard isLoading else {
                showSkeleton = false
                return
            }
            try? await Task.sleep(for: .milliseconds(300))
            if !Task.isCancelled {
                showSkeleton = true
            }
        }
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
        .onChange(of: draft) {
            handleDraftChange()
        }
        .onChange(of: store.diffStats) {
            guard completionFiles != nil else { return }
            completionFiles = nil
            preparedFileCandidates = nil
            if activeAutocomplete?.trigger == .file {
                loadFileCompletionsIfNeeded()
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
            store.isChatVisible = false
            saveCurrentDraft()
            store.onTurnCompleted = nil
            projectStore.statusMonitor.clearViewingSession(workspaceId: workspace.id, sessionId: session.sessionId)
        }
    }

    // MARK: - Find in Conversation

    private var findableMessages: [FindableMessage] {
        store.messages.compactMap { message in
            if message.role == .user && message.content == "Question dismissed." { return nil }
            if message.role == .assistant && message.cancelled == true { return nil }
            return FindableMessage(id: message.id, content: message.content,
                                   rendersMarkdown: message.role == .assistant)
        }
    }

    private func openFind() {
        withAnimation(.snappy(duration: 0.25)) { findOpen = true }
        Task {
            try? await Task.sleep(for: .milliseconds(50))
            findFieldFocused = true
        }
    }

    private func closeFind() {
        findFieldFocused = false
        findQuery = ""
        findModel.reset()
        withAnimation(.snappy(duration: 0.25)) { findOpen = false }
    }

    /// Anchor the match's message proportionally to where the match sits in it,
    /// so a hit deep inside a long message still lands on screen. Prefers the
    /// UIKit scroller (smooth, distance-scaled animation on the List's backing
    /// collection view); SwiftUI's animated `scrollTo` stutters on rows whose
    /// heights are still estimated.
    private func scrollToFindMatch(_ match: ConversationFindMatch, proxy: ScrollViewProxy) {
        let displayed = store.messages.filter { !($0.role == .user && $0.content == "Question dismissed.") }
        guard let row = displayed.firstIndex(where: { $0.id == match.messageId }) else { return }

        let length = max(1, findModel.searchableLength(of: match.messageId) ?? 1)
        let ratio = min(0.85, max(0.15, Double(match.range.lowerBound) / Double(length)))

        var expectedRows = displayed.count + 1
        if streamingMessage != nil { expectedRows += 1 }
        if store.isStreaming { expectedRows += 1 }

        if transcriptScroller.scrollToItem(row, expectedItemCount: expectedRows, anchorRatio: ratio) {
            return
        }
        withAnimation(.easeInOut(duration: 0.25)) {
            proxy.scrollTo(match.messageId, anchor: UnitPoint(x: 0.5, y: ratio))
        }
    }

    // MARK: - Composer

    private var composerStack: some View {
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
            if !store.pendingToolInputs.isEmpty, !showQuestionSheet {
                PendingQuestionChip(count: store.pendingToolInputs.count) {
                    showQuestionSheet = true
                }
            }
            if let failed = store.failedSend {
                FailedSendRow(
                    failed: failed,
                    onRetry: { Task { await store.retryFailedSend(for: failed.sessionId) } },
                    onDiscard: { store.discardFailedSend(for: failed.sessionId) }
                )
            }
            if !suggestions.isEmpty {
                ComposerSuggestionPanel(suggestions: suggestions, onSelect: acceptSuggestion)
                    .padding(.horizontal, 12)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
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

    // MARK: - Streaming Activity

    private static let scrollBottomTolerance: CGFloat = 96

    private var streamingMessage: ChatMessage? {
        guard store.isStreaming else { return nil }
        let hasContent = !store.currentText.isEmpty || !store.currentThinking.isEmpty
            || !store.activeToolCalls.isEmpty || !store.activeAgentActivities.isEmpty
        guard hasContent else { return nil }

        return ChatMessage(
            id: "streaming",
            sessionId: store.sessionId ?? "",
            role: .assistant,
            content: store.currentText,
            images: nil,
            toolCalls: store.activeToolCalls.isEmpty ? nil : store.activeToolCalls,
            agentActivities: store.activeAgentActivities.isEmpty ? nil : store.activeAgentActivities,
            thinkingContent: store.currentThinking.isEmpty ? nil : store.currentThinking,
            timestamp: store.streamingStartedAt.map(ConversationStore.timestamp(from:)) ?? "",
            cancelled: nil,
            durationMs: nil
        )
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
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(streamingAccessibilityLabel(at: timeline.date))
        }
    }

    /// One natural-language label for the streaming indicator, bucketed to whole
    /// minutes so VoiceOver announces "Agent working, 2 minutes" instead of
    /// re-reading a sub-second timer.
    private func streamingAccessibilityLabel(at date: Date) -> String {
        guard let startedAt = store.streamingStartedAt else { return "Agent working" }
        let minutes = Int(max(0, date.timeIntervalSince(startedAt))) / 60
        guard minutes >= 1 else { return "Agent working" }
        return "Agent working, \(minutes) minute\(minutes == 1 ? "" : "s")"
    }

    // MARK: - Setup

    private func setup() async {
        store.isChatVisible = true
        projectStore.statusMonitor.setViewingWorkspace(workspace.id, sessionId: session.sessionId)
        projectStore.statusMonitor.clearCompleted(workspace.id)
        projectStore.statusMonitor.clearUnread(workspaceId: workspace.id, sessionId: session.sessionId)
        let selectedSessionId = session.sessionId

        // Wire post-turn re-sync: after done/cancelled, re-fetch messages from REST
        // so client-generated UUIDs are replaced with backend-assigned IDs.
        store.onTurnCompleted = { [weak store, api, workspace] sessionId in
            Task { @MainActor [weak store] in
                guard let store, store.sessionId == sessionId else { return }
                await store.loadHistoryIfNeeded(for: sessionId) { since in
                    try await api.fetchMessages(workspaceId: workspace.id, sessionId: sessionId, since: since)
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
        // Instant-load: show cached messages immediately (if any) so the bubble
        // isn't empty while the authoritative REST refetch runs.
        if store.messages.isEmpty, let cached = store.cachedMessages(for: sessionId), !cached.isEmpty {
            store.messages = cached
            isLoading = false
        }
        await store.loadHistoryIfNeeded(for: sessionId) { since in
            try await api.fetchMessages(workspaceId: workspace.id, sessionId: sessionId, since: since)
        }
        isLoading = false
    }

    // MARK: - Composer Autocomplete

    private var supportsCompletions: Bool {
        selectedCapabilities?.completions ?? true
    }

    /// Provider whose `/` commands apply: the locked provider when the session
    /// is pinned, else the selected model's provider. Mirrors the web.
    private var completionProvider: String? {
        lockedProvider ?? (selectedModelId.isEmpty ? nil : selectedModelId.split(separator: ":").first.map(String.init))
    }

    private var suggestions: [ComposerSuggestion] {
        guard let active = activeAutocomplete else { return [] }
        switch active.trigger {
        case .file:
            guard let candidates = preparedFileCandidates else { return [] }
            return ComposerAutocomplete.matchFiles(candidates, query: active.query).map { .file($0) }
        case .command, .agent:
            guard let items = completionItems else { return [] }
            let type = active.trigger == .command ? "slash_command" : "agent"
            return ComposerAutocomplete.filterItems(items, type: type, query: active.query).map { .item($0) }
        }
    }

    private func handleDraftChange() {
        draftFileMentions = ComposerAutocomplete.pruneMentions(draftFileMentions, text: draft)

        let active = ComposerAutocomplete.detect(in: draft, supportsCompletions: supportsCompletions)
        withAnimation(.snappy(duration: 0.22)) {
            activeAutocomplete = active
        }
        guard let active else { return }

        switch active.trigger {
        case .file:
            loadFileCompletionsIfNeeded()
        case .command, .agent:
            loadCompletionItemsIfNeeded()
        }
    }

    private func loadFileCompletionsIfNeeded() {
        guard completionFiles == nil else { return }
        completionFiles = []
        preparedFileCandidates = []
        Task {
            guard let files = try? await api.fetchFileCompletions(workspaceId: workspace.id) else {
                completionFiles = nil
                preparedFileCandidates = nil
                return
            }
            let prepared = ComposerAutocomplete.prepareFiles(files)
            withAnimation(.snappy(duration: 0.22)) {
                completionFiles = files
                preparedFileCandidates = prepared
            }
        }
    }

    private func loadCompletionItemsIfNeeded() {
        let provider = completionProvider
        guard completionItems == nil || completionItemsProvider != provider else { return }
        completionItems = []
        completionItemsProvider = provider
        Task {
            guard let items = try? await api.fetchCompletions(workspaceId: workspace.id, provider: provider) else {
                if completionItemsProvider == provider { completionItems = nil }
                return
            }
            guard completionItemsProvider == provider else { return }
            withAnimation(.snappy(duration: 0.22)) { completionItems = items }
        }
    }

    private func acceptSuggestion(_ suggestion: ComposerSuggestion) {
        guard let active = activeAutocomplete else { return }

        switch suggestion {
        case .file(let match):
            let displayName = ComposerAutocomplete.disambiguate(match.path, in: completionFiles ?? [])
            draft = ComposerAutocomplete.inserting("#\(displayName)", into: draft, active: active)
            draftFileMentions.removeAll { $0.relativePath == match.path }
            draftFileMentions.append(FileMention(displayName: displayName, relativePath: match.path))
        case .item(let item):
            draft = ComposerAutocomplete.inserting(item.label, into: draft, active: active)
        }
        withAnimation(.snappy(duration: 0.22)) {
            activeAutocomplete = nil
        }
    }

    // MARK: - Send

    private func sendMessage(images: [ImageAttachment]) {
        let content = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty || !images.isEmpty else { return }

        let targetSessionId = session.sessionId
        let mentions = ComposerAutocomplete.pruneMentions(draftFileMentions, text: content)
        let fileMentions = mentions.isEmpty ? nil : mentions
        draft = ""
        draftAttachments = []
        draftFileMentions = []

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

        // Show the message in the transcript immediately; the server echo
        // confirms delivery, a send failure marks it Not delivered with Retry.
        let localId = store.appendOptimisticUserMessage(
            content: content,
            images: images.isEmpty ? nil : images,
            fileMentions: fileMentions,
            options: options,
            sessionId: targetSessionId
        )

        Task {
            let sent = await store.send?(.userMessage(
                content: content,
                images: images.isEmpty ? nil : images,
                fileMentions: fileMentions,
                options: options,
                sessionId: targetSessionId
            )) ?? false

            if sent {
                // Bump history token so any in-flight REST fetch won't overwrite the
                // user_message echo that the backend is about to broadcast.
                store.bumpHistoryToken(for: targetSessionId)
            } else {
                store.markSendFailed(localId)
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

            switch result {
            case .approve, .answer:
                Haptics.notify(sent ? .success : .warning)
            case .reject, .dismiss:
                Haptics.notify(.warning)
            }

            if sent {
                store.clearPendingToolInputs()
                store.bumpHistoryToken(for: pending.sessionId)
                // Auto-disable plan mode toggle on approve
                if pending.toolName == "ExitPlanMode", case .approve = result {
                    planModeEnabled = false
                    store.setAgentPlanMode(false, for: pending.sessionId)
                }
            } else {
                store.recordFailedSend(FailedSend(
                    id: UUID().uuidString,
                    sessionId: pending.sessionId,
                    content: "Answer to the agent's question",
                    reason: "Disconnected from server",
                    pending: pending
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
        scrollToBottom(proxy, force: false)
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy, force: Bool) {
        guard force || (isNearScrollBottom && !isTouchingTranscript && !findOpen) else { return }
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

/// Reports whether a finger is currently down on the transcript List, via a
/// zero-duration UIKit long-press attached to the List's UICollectionView
/// (SwiftUI gestures on a List never fire for stationary touches).
/// Smooth find-navigation scrolling on the List's backing UICollectionView.
/// Estimated row heights can drift while the animation runs, so a completion
/// pass re-measures and settles with a short follow-up animation.
@MainActor
final class TranscriptScroller {
    weak var collectionView: UICollectionView?
    private var animator: UIViewPropertyAnimator?

    func cancelScroll() {
        animator?.stopAnimation(true)
        animator = nil
    }

    func scrollToItem(_ flatIndex: Int, expectedItemCount: Int, anchorRatio: Double) -> Bool {
        guard let cv = collectionView,
              totalItems(in: cv) == expectedItemCount,
              let indexPath = indexPath(forFlatIndex: flatIndex, in: cv),
              let target = targetOffset(in: cv, indexPath: indexPath, anchorRatio: anchorRatio)
        else { return false }
        cancelScroll()
        animate(cv, to: target, indexPath: indexPath, anchorRatio: anchorRatio, allowCorrection: true)
        return true
    }

    private func totalItems(in cv: UICollectionView) -> Int {
        (0..<cv.numberOfSections).reduce(0) { $0 + cv.numberOfItems(inSection: $1) }
    }

    private func indexPath(forFlatIndex flatIndex: Int, in cv: UICollectionView) -> IndexPath? {
        var remaining = flatIndex
        for section in 0..<cv.numberOfSections {
            let count = cv.numberOfItems(inSection: section)
            if remaining < count { return IndexPath(item: remaining, section: section) }
            remaining -= count
        }
        return nil
    }

    private func targetOffset(in cv: UICollectionView, indexPath: IndexPath, anchorRatio: Double) -> CGFloat? {
        guard let attrs = cv.layoutAttributesForItem(at: indexPath) else { return nil }
        let insets = cv.adjustedContentInset
        let visibleHeight = cv.bounds.height - insets.top - insets.bottom
        guard visibleHeight > 0 else { return nil }
        let anchorInContent = attrs.frame.minY + attrs.frame.height * CGFloat(anchorRatio)
        let raw = anchorInContent - insets.top - visibleHeight * CGFloat(anchorRatio)
        let minY = -insets.top
        let maxY = max(minY, cv.contentSize.height + insets.bottom - cv.bounds.height)
        return min(max(raw, minY), maxY)
    }

    private func animate(
        _ cv: UICollectionView,
        to target: CGFloat,
        indexPath: IndexPath,
        anchorRatio: Double,
        allowCorrection: Bool
    ) {
        let distance = abs(target - cv.contentOffset.y)
        guard distance > 1 else { return }
        let duration = min(0.55, 0.3 + Double(distance) / 6000)
        let animator = UIViewPropertyAnimator(
            duration: duration,
            controlPoint1: CGPoint(x: 0.3, y: 0),
            controlPoint2: CGPoint(x: 0.2, y: 1)
        )
        animator.addAnimations {
            cv.contentOffset = CGPoint(x: cv.contentOffset.x, y: target)
        }
        animator.addCompletion { [weak self, weak cv] position in
            guard position == .end, allowCorrection, let self, let cv else { return }
            MainActor.assumeIsolated {
                if let corrected = self.targetOffset(in: cv, indexPath: indexPath, anchorRatio: anchorRatio),
                   abs(corrected - cv.contentOffset.y) > 24 {
                    self.animate(cv, to: corrected, indexPath: indexPath, anchorRatio: anchorRatio, allowCorrection: false)
                }
            }
        }
        self.animator = animator
        animator.startAnimation()
    }
}

private struct TranscriptTouchProbe: UIViewRepresentable {
    let onChange: (Bool) -> Void
    var onCollectionView: ((UICollectionView) -> Void)? = nil

    func makeUIView(context: Context) -> ProbeView {
        let view = ProbeView()
        view.onChange = onChange
        view.onCollectionView = onCollectionView
        return view
    }

    func updateUIView(_ uiView: ProbeView, context: Context) {
        uiView.onChange = onChange
        uiView.onCollectionView = onCollectionView
    }

    final class ProbeView: UIView, UIGestureRecognizerDelegate {
        var onChange: ((Bool) -> Void)?
        var onCollectionView: ((UICollectionView) -> Void)?
        private weak var attachedTo: UIView?
        private var attachAttemptsRemaining = 0

        override func didMoveToWindow() {
            super.didMoveToWindow()
            attachAttemptsRemaining = 20
            DispatchQueue.main.async { [weak self] in
                self?.attachIfNeeded()
            }
        }

        private func attachIfNeeded() {
            guard window != nil, attachedTo == nil else { return }
            guard let target = findCollectionView() else {
                attachAttemptsRemaining -= 1
                guard attachAttemptsRemaining > 0 else { return }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
                    self?.attachIfNeeded()
                }
                return
            }
            let press = UILongPressGestureRecognizer(target: self, action: #selector(pressChanged(_:)))
            press.minimumPressDuration = 0
            press.cancelsTouchesInView = false
            press.delegate = self
            target.addGestureRecognizer(press)
            attachedTo = target
            onCollectionView?(target)
        }

        private func findCollectionView() -> UICollectionView? {
            var ancestor = superview
            while let current = ancestor {
                var queue: [UIView] = [current]
                var visited = 0
                while !queue.isEmpty, visited < 500 {
                    let view = queue.removeFirst()
                    visited += 1
                    if let collection = view as? UICollectionView { return collection }
                    queue.append(contentsOf: view.subviews)
                }
                ancestor = current.superview
            }
            return nil
        }

        @objc private func pressChanged(_ gesture: UILongPressGestureRecognizer) {
            switch gesture.state {
            case .began:
                onChange?(true)
            case .ended, .cancelled, .failed:
                onChange?(false)
            default:
                break
            }
        }

        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
        ) -> Bool {
            true
        }
    }
}

private struct PendingQuestionChip: View {
    let count: Int
    let onTap: () -> Void

    @AppStorage("hiveAccent") private var accentId = AccentOption.defaultId
    private var accent: Color {
        AccentOption(rawValue: accentId)?.color ?? AccentOption.violet.color
    }

    private var label: String {
        count == 1 ? "1 question waiting" : "\(count) questions waiting"
    }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 8) {
                Image(systemName: "questionmark.bubble.fill")
                Text(label)
                    .font(.caption.weight(.semibold))
                Spacer(minLength: 4)
                Image(systemName: "chevron.up")
                    .font(.caption2.weight(.semibold))
            }
            .foregroundStyle(accent)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(accent.opacity(0.12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(accent.opacity(0.3), lineWidth: 0.5)
                    )
            )
        }
        .buttonStyle(.plain)
        .accessibilityHint("Reopens the agent's question.")
    }
}

private struct FailedSendRow: View {
    let failed: FailedSend
    let onRetry: () -> Void
    let onDiscard: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(WhisperColor.danger)
            VStack(alignment: .leading, spacing: 2) {
                Text(failed.reason)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(WhisperColor.danger)
                Text(failed.content)
                    .font(.caption)
                    .foregroundStyle(WhisperColor.textSecondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Button(action: onRetry) {
                Label("Retry", systemImage: "arrow.clockwise")
                    .labelStyle(.titleAndIcon)
                    .font(.caption.weight(.semibold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(WhisperColor.danger)
            Button(action: onDiscard) {
                Image(systemName: "xmark")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(WhisperColor.textMuted)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Discard failed send")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(WhisperColor.danger.opacity(0.12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(WhisperColor.danger.opacity(0.3), lineWidth: 0.5)
                )
        )
    }
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

private extension View {
    func chatTranscriptRow() -> some View {
        self
            .frame(maxWidth: .infinity, alignment: .leading)
            .listRowInsets(EdgeInsets(
                top: HiveSpacing.sm,
                leading: HiveSpacing.lg,
                bottom: HiveSpacing.sm,
                trailing: HiveSpacing.lg
            ))
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
    }

    func chatTranscriptAnchorRow() -> some View {
        self
            .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: HiveSpacing.sm, trailing: 0))
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
    }
}
