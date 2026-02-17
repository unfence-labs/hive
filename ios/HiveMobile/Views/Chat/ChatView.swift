import SwiftUI

struct ChatView: View {
    let workspace: Workspace

    @State private var messages: [ChatMessage] = []
    @State private var isLoading = true

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
            }
            .onChange(of: messages.count) {
                if let lastId = messages.last?.id {
                    withAnimation {
                        proxy.scrollTo(lastId, anchor: .bottom)
                    }
                }
            }
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
        }
        .overlay {
            if isLoading {
                ProgressView()
            }
        }
        .task {
            await loadMessages()
        }
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
            // Will show empty state — error handling improved later
        }
        isLoading = false
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
