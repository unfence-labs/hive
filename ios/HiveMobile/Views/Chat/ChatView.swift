import Combine
import SwiftUI

struct ChatView: View {
    let workspace: Workspace

    @State private var store = ConversationStore()
    @State private var draft = ""
    @State private var isLoading = true
    @State private var wsManager = WebSocketManager()
    @State private var sessions: [SessionMetadata] = []
    @State private var activeSessionId: String?
    @State private var showSessionSheet = false
    @State private var thinkingEnabled = true
    @State private var planModeEnabled = false
    @State private var selectedModelId: String = ""
    @State private var draftAttachments: [ImageAttachment] = []

    @Environment(ModelCatalog.self) private var modelCatalog

    private let api = APIClient()
    private let draftStore = ChatDraftStore.shared

    private var lockedProvider: String? {
        store.lockedProvider ?? sessions.first { $0.sessionId == activeSessionId }?.lockedProvider
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
            ChatInputBar(
                draft: $draft,
                draftAttachments: draftAttachments,
                isBusy: store.isBusy,
                thinkingEnabled: $thinkingEnabled,
                planModeEnabled: $planModeEnabled,
                models: modelCatalog.models,
                groupedModels: modelCatalog.groupedByProvider,
                selectedModelId: selectedModelId,
                defaultModelId: modelCatalog.defaultModelId,
                lockedProvider: lockedProvider,
                onModelSelect: { selectedModelId = $0 },
                onDraftAttachmentsChange: { draftAttachments = $0 },
                onSend: sendMessage,
                onStop: { Task { await wsManager.send(.stop(sessionId: nil)) } }
            )
            .padding(.horizontal, 12)
            .padding(.bottom, 4)
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
                store.clearPendingToolInputs()
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
            wsManager.disconnect()
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
        await loadSessions()
        activeSessionId = workspace.activeSessionId ?? sessions.first?.sessionId
        store.setFocusedSessionId(activeSessionId)

        if let sessionId = activeSessionId {
            restoreDraft(for: sessionId)
        }

        if selectedModelId.isEmpty {
            selectedModelId = modelCatalog.defaultModelId
        }

        wsManager.connect(workspaceId: workspace.id)
        listenToWebSocket()

        await loadMessages()
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
        do {
            store.messages = try await api.fetchMessages(
                workspaceId: workspace.id,
                sessionId: sessionId
            )
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
            await wsManager.send(.switchSession(sessionId: sessionId))
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

    // MARK: - WebSocket

    private func listenToWebSocket() {
        Task {
            for await event in wsManager.messages {
                store.handle(event)
            }
        }
    }

    // MARK: - Send

    private func sendMessage(images: [ImageAttachment]) {
        let content = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty || !images.isEmpty else { return }
        draft = ""
        draftAttachments = []

        let options = MessageOptions(
            planMode: planModeEnabled ? true : nil,
            thinkingEnabled: thinkingEnabled ? true : nil,
            model: selectedModelId.isEmpty ? nil : selectedModelId
        )

        Task {
            await wsManager.send(.userMessage(
                content: content,
                images: images.isEmpty ? nil : images,
                options: options,
                sessionId: nil
            ))
        }
    }

    private func respondToTool(pending: PendingToolInput, result: ToolInputResult) {
        Task {
            await wsManager.send(.toolInputResponse(
                requestId: pending.requestId,
                toolName: pending.toolName,
                result: result,
                sessionId: pending.sessionId
            ))
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
            if let modelId = saved.selectedModelId {
                selectedModelId = modelId
            }
            draftAttachments = saved.attachments.map(ImageAttachment.init)
        } else {
            draft = ""
            thinkingEnabled = true
            planModeEnabled = false
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
        ChatView(workspace: Workspace(
            id: "ws-1", name: "san-antonio-v1", branch: "0xlny/ios-app",
            status: .idle, createdAt: "", activeSessionId: "sess-1",
            projectName: "hive", defaultBranch: "main"
        ))
    }
    .environment(ModelCatalog())
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
