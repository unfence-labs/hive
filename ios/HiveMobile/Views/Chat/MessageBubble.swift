import MarkdownUI
import SwiftUI

struct MessageBubble: View {
    let message: ChatMessage

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            if message.role == .user { Spacer(minLength: 60) }

            VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 6) {
                // Thinking block (collapsible)
                if let thinking = message.thinkingContent, !thinking.isEmpty {
                    ThinkingBlock(content: thinking)
                }

                // Tool calls (collapsible)
                if let tools = message.toolCalls, !tools.isEmpty {
                    ToolCallsBlock(toolCalls: tools)
                }

                // Message content
                messageContent

                // Timestamp
                if message.id != "streaming" {
                    Text(formatTimestamp(message.timestamp))
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }

            if message.role == .assistant { Spacer(minLength: 40) }
        }
    }

    @ViewBuilder
    private var messageContent: some View {
        // Image attachments (user messages only)
        if message.role == .user, let images = message.images, !images.isEmpty {
            ForEach(Array(images.enumerated()), id: \.offset) { _, img in
                if img.dataUrl.hasPrefix("data:"), let uiImage = decodeBase64Image(img.dataUrl) {
                    Image(uiImage: uiImage)
                        .resizable()
                        .scaledToFit()
                        .frame(maxHeight: 200)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                } else if let url = resolveImageURL(img.dataUrl) {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let image):
                            image.resizable().scaledToFit()
                                .frame(maxHeight: 200)
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                        case .failure:
                            Label(img.name, systemImage: "photo")
                                .font(.caption).foregroundStyle(.secondary)
                        default:
                            ProgressView().frame(height: 80)
                        }
                    }
                }
            }
        }

        if message.content.isEmpty { EmptyView() }
        else {
            switch message.role {
            case .user:
                Text(message.content)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 18))
                    .overlay(
                        RoundedRectangle(cornerRadius: 18)
                            .fill(Color.accentColor.opacity(0.1))
                            .allowsHitTesting(false)
                    )
            case .assistant:
                Markdown(message.content)
                    .markdownTheme(.chat)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            }
        }
    }

    private func resolveImageURL(_ dataUrl: String) -> URL? {
        guard dataUrl.hasPrefix("/api/") else { return nil }
        let host = UserDefaults.standard.string(forKey: "serverHost") ?? "localhost"
        let port = UserDefaults.standard.string(forKey: "serverPort") ?? "3000"
        let token = UserDefaults.standard.string(forKey: "authToken") ?? ""
        var urlString = "http://\(host):\(port)\(dataUrl)"
        if !token.isEmpty {
            let sep = dataUrl.contains("?") ? "&" : "?"
            urlString += "\(sep)token=\(token)"
        }
        return URL(string: urlString)
    }

    private func decodeBase64Image(_ dataUrl: String) -> UIImage? {
        guard let range = dataUrl.range(of: ";base64,") else { return nil }
        let base64 = String(dataUrl[range.upperBound...])
        guard let data = Data(base64Encoded: base64) else { return nil }
        return UIImage(data: data)
    }

    private func formatTimestamp(_ ts: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: ts) else { return "" }
        let display = DateFormatter()
        display.timeStyle = .short
        return display.string(from: date)
    }
}

// MARK: - Thinking Block

private struct ThinkingBlock: View {
    let content: String
    @State private var isExpanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            Text(content)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 4)
        } label: {
            Label("Thinking", systemImage: "brain")
                .font(.caption)
                .foregroundStyle(.accent)
        }
        .tint(.accent)
    }
}

// MARK: - Tool Calls Block

private struct ToolCallsBlock: View {
    let toolCalls: [ToolCall]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(topLevelCalls) { tool in
                ToolCallRow(
                    tool: tool,
                    children: childCalls(for: tool.id)
                )
            }
        }
        .overlay(alignment: .leading) {
            Rectangle()
                .fill(Color.accentColor.opacity(0.3))
                .frame(width: 2)
        }
        .padding(.leading, 6)
    }

    private var topLevelCalls: [ToolCall] {
        toolCalls.filter { $0.parentToolUseId == nil }
    }

    private func childCalls(for parentId: String) -> [ToolCall] {
        toolCalls.filter { $0.parentToolUseId == parentId }
    }
}

private struct ToolCallRow: View {
    let tool: ToolCall
    let children: [ToolCall]
    @State private var isExpanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            VStack(alignment: .leading, spacing: 6) {
                if let output = tool.output, !output.isEmpty {
                    Text(output)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(isExpanded ? nil : 5)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                ForEach(children) { child in
                    ToolCallRow(tool: child, children: [])
                        .padding(.leading, 12)
                }
            }
            .padding(.top, 4)
        } label: {
            Label {
                Text(tool.name)
                    .font(.caption)
                    .bold()
            } icon: {
                Image(systemName: iconName(for: tool.name))
                    .font(.caption2)
            }
            .foregroundStyle(.secondary)
        }
        .tint(.secondary)
    }

    private func iconName(for toolName: String) -> String {
        switch toolName {
        case "Read": return "doc.text"
        case "Write", "Edit": return "pencil"
        case "Bash": return "terminal"
        case "Grep": return "magnifyingglass"
        case "Glob": return "folder.badge.magnifyingglass"
        case "WebSearch", "WebFetch": return "globe"
        case "Task": return "arrow.triangle.branch"
        default: return "wrench"
        }
    }
}

// MARK: - Chat Markdown Theme

private extension Theme {
    static let chat = Theme.gitHub
        .text {
            BackgroundColor(.clear)
            ForegroundColor(.primary)
        }
        .code {
            BackgroundColor(Color(.systemFill))
        }
}

#Preview {
    ScrollView {
        VStack(spacing: 16) {
            MessageBubble(message: ChatMessage(
                id: "1", sessionId: "s1", role: .user,
                content: "Can you fix the login bug?",
                images: nil, toolCalls: nil, thinkingContent: nil,
                timestamp: "2026-02-17T12:00:00.000Z", cancelled: nil, durationMs: nil
            ))
            MessageBubble(message: ChatMessage(
                id: "2", sessionId: "s1", role: .assistant,
                content: "I'll look into the **authentication flow**. Let me check the relevant files first.\n\n```swift\nfunc login() { }\n```",
                images: nil,
                toolCalls: [
                    ToolCall(id: "t1", name: "Read", input: "auth.swift", output: "func login() { ... }", parentToolUseId: nil),
                    ToolCall(id: "t2", name: "Edit", input: "auth.swift", output: "Fixed the bug", parentToolUseId: nil),
                ],
                thinkingContent: "The user wants me to fix a login bug. Let me look at the auth module.",
                timestamp: "2026-02-17T12:00:05.000Z", cancelled: nil, durationMs: 3200
            ))
        }
        .padding()
    }
    .preferredColorScheme(.dark)
}
