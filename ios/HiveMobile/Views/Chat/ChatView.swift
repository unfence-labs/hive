import SwiftUI

struct ChatView: View {
    let workspace: Workspace

    @State private var messages: [ChatMessage] = []
    @State private var draft = ""
    @State private var isLoading = true
    @State private var isBusy = false
    @State private var wsManager = WebSocketManager()

    private let api = APIClient()

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 16) {
                    ForEach(messages) { message in
                        MessageBubble(message: message)
                            .id(message.id)
                    }
                }
                .padding()
                .padding(.bottom, 60)
            }
            .onChange(of: messages.count) {
                scrollToBottom(proxy)
            }
        }
        .safeAreaInset(edge: .bottom) {
            ChatInputBar(draft: $draft, isBusy: isBusy, onSend: sendMessage)
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
                if isBusy {
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
            messages = try await api.fetchMessages(
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
                handleEvent(event)
            }
        }
    }

    private func handleEvent(_ event: WsOutgoing) {
        switch event {
        case .userMessage(let msg):
            messages.append(msg)
        case .status(let status, _, let streaming, _):
            isBusy = status == .busy || streaming == true
        case .history(let msgs, _):
            messages = msgs
        default:
            break // streaming events handled in task #8
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
        if let lastId = messages.last?.id {
            withAnimation { proxy.scrollTo(lastId, anchor: .bottom) }
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
