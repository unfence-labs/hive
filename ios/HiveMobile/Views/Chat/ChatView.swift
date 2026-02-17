import SwiftUI

struct ChatView: View {
    let workspace: Workspace

    @State private var store = ConversationStore()
    @State private var draft = ""
    @State private var isLoading = true
    @State private var wsManager = WebSocketManager()
    @State private var sessions: [SessionMetadata] = []
    @State private var activeSessionId: String?

    private let api = APIClient()

    var body: some View {
        @Bindable var store = store
        VStack(spacing: 0) {
            if sessions.count > 1 {
                SessionTabBar(
                    sessions: sessions,
                    activeSessionId: activeSessionId,
                    onSelect: { switchSession($0) },
                    onCreate: { createSession() }
                )
            }

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
                    .padding()
                    .padding(.bottom, 60)
                }
                .onChange(of: store.displayMessages.count) {
                    scrollToBottom(proxy)
                }
                .onChange(of: store.currentText) {
                    scrollToBottom(proxy)
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            ChatInputBar(draft: $draft, isBusy: store.isBusy, onSend: sendMessage)
                .padding(.horizontal, 12)
                .padding(.bottom, 4)
        }
        .navigationTitle(workspace.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 2) {
                    Text(workspace.name)
                        .font(.headline)
                    HStack(spacing: 4) {
                        Text(store.branchInfo?.name ?? workspace.branch)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        if let pr = store.branchInfo?.pr {
                            Text("#\(pr.number)")
                                .font(.caption2)
                                .foregroundStyle(prColor(pr.state))
                        }
                        if let diff = store.diffStats {
                            let total = diff.committed.count + diff.uncommitted.count
                            if total > 0 {
                                Text("\(total) files")
                                    .font(.caption2)
                                    .foregroundStyle(.orange)
                            }
                        }
                    }
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                HStack(spacing: 12) {
                    if store.isBusy {
                        Button {
                            Task { await wsManager.send(.stop(sessionId: nil)) }
                        } label: {
                            Image(systemName: "stop.circle")
                                .foregroundStyle(.red)
                        }
                    }

                    Menu {
                        Button("New Session", systemImage: "plus") {
                            createSession()
                        }
                        if sessions.count > 1 {
                            Divider()
                            ForEach(sessions) { session in
                                Button {
                                    switchSession(session.sessionId)
                                } label: {
                                    Label(
                                        session.title ?? "Session",
                                        systemImage: session.sessionId == activeSessionId ? "checkmark" : "bubble.left"
                                    )
                                }
                            }
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
        }
        .overlay {
            if isLoading { ProgressView() }
        }
        .sheet(item: $store.pendingToolInput) { pending in
            ToolInputSheet(pending: pending) { result in
                respondToTool(pending: pending, result: result)
                store.pendingToolInput = nil
            }
        }
        .task { await setup() }
        .onDisappear { wsManager.disconnect() }
    }

    // MARK: - Streaming indicator

    private var streamingIndicator: some View {
        HStack(spacing: 4) {
            ForEach(0..<3, id: \.self) { _ in
                Circle()
                    .fill(.secondary)
                    .frame(width: 6, height: 6)
                    .opacity(0.5)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .id("streaming-indicator")
    }

    // MARK: - Setup

    private func setup() async {
        activeSessionId = workspace.activeSessionId
        wsManager.connect(workspaceId: workspace.id)
        async let messagesLoad: () = loadMessages()
        async let sessionsLoad: () = loadSessions()
        await messagesLoad
        await sessionsLoad
        listenToWebSocket()
    }

    private func loadSessions() async {
        do {
            sessions = try await api.fetchSessions(workspaceId: workspace.id)
        } catch {
            // non-critical — chat still works without session list
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
        } catch {
            // empty state for now
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
            do {
                let session = try await api.createSession(workspaceId: workspace.id)
                sessions.append(session)
                switchSession(session.sessionId)
            } catch {
                print("[ChatView] createSession failed:", error)
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

    private func sendMessage() {
        let content = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else { return }
        draft = ""
        Task {
            await wsManager.send(.userMessage(
                content: content, images: nil, options: nil, sessionId: nil
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

    private func prColor(_ state: PRState) -> Color {
        switch state {
        case .open, .draft: .green
        case .merged: .purple
        case .closed: .red
        }
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        if let lastId = store.displayMessages.last?.id {
            withAnimation(.easeOut(duration: 0.15)) {
                proxy.scrollTo(lastId, anchor: .bottom)
            }
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
