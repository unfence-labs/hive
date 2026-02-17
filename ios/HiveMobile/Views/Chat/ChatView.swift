import SwiftUI

struct ChatView: View {
    let workspace: Workspace

    @State private var store = ConversationStore()
    @State private var draft = ""
    @State private var isLoading = true
    @State private var wsManager = WebSocketManager()

    private let api = APIClient()

    var body: some View {
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
                    Text(workspace.branch)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                if store.isBusy {
                    Button {
                        Task { await wsManager.send(.stop(sessionId: nil)) }
                    } label: {
                        Image(systemName: "stop.circle")
                            .foregroundStyle(.red)
                    }
                }
            }
        }
        .overlay {
            if isLoading { ProgressView() }
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
        wsManager.connect(workspaceId: workspace.id)
        await loadMessages()
        listenToWebSocket()
    }

    private func loadMessages() async {
        guard let sessionId = workspace.activeSessionId else {
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
