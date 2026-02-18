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
    @State private var selectedModel: ClaudeModel = .opus

    private let api = APIClient()

    var body: some View {
        VStack(spacing: 0) {
            if isLoading {
                Spacer()
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 16) {
                            ForEach(store.displayMessages) { message in
                                MessageBubble(message: message)
                                    .id(message.id)
                            }

                            if store.isStreaming && store.streamingMessage == nil {
                                streamingIndicator
                            }
                        }
                        .scrollTargetLayout()
                        .padding()
                    }
                    .defaultScrollAnchor(.bottom)
                    .scrollDismissesKeyboard(.interactively)
                    .onTapGesture {
                        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                    }
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
                isBusy: store.isBusy,
                thinkingEnabled: $thinkingEnabled,
                planModeEnabled: $planModeEnabled,
                selectedModel: $selectedModel,
                onSend: sendMessage
            )
            .padding(.horizontal, 12)
            .padding(.bottom, 4)
        }
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
                HStack(spacing: 12) {
                    if store.isBusy {
                        Button {
                            Task { await wsManager.send(.stop(sessionId: nil)) }
                        } label: {
                            Image(systemName: "stop.circle.fill")
                                .foregroundStyle(.red)
                        }
                    }

                    Button {
                        showSessionSheet = true
                    } label: {
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
        .onDisappear { wsManager.disconnect() }
    }

    // MARK: - Streaming Indicator

    private var streamingIndicator: some View {
        HStack(spacing: 3) {
            ForEach(0..<3, id: \.self) { _ in
                Circle()
                    .fill(WhisperColor.textMuted)
                    .frame(width: 4, height: 4)
            }
        }
        .shimmer()
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.leading, 2)
        .id("streaming-indicator")
    }

    // MARK: - Setup

    private func setup() async {
        wsManager.connect(workspaceId: workspace.id)
        listenToWebSocket()

        await loadSessions()
        activeSessionId = workspace.activeSessionId ?? sessions.first?.sessionId

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
        activeSessionId = sessionId
        store.messages = []
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

        let options = MessageOptions(
            planMode: planModeEnabled ? true : nil,
            thinkingEnabled: thinkingEnabled ? true : nil,
            model: selectedModel.rawValue
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

    private func scrollToBottom(_ proxy: ScrollViewProxy, animated: Bool = true) {
        guard let lastId = store.displayMessages.last?.id else { return }
        if animated {
            withAnimation(.easeOut(duration: 0.15)) {
                proxy.scrollTo(lastId, anchor: .bottom)
            }
        } else {
            proxy.scrollTo(lastId, anchor: .bottom)
        }
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
    .preferredColorScheme(.dark)
}
