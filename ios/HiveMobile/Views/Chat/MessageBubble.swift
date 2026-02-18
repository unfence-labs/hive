import MarkdownUI
import SwiftUI

struct MessageBubble: View {
    let message: ChatMessage

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            if message.role == .user { Spacer(minLength: 60) }

            VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 6) {
                if let thinking = message.thinkingContent, !thinking.isEmpty {
                    WhisperThinkingBlock(content: thinking)
                }

                if let tools = message.toolCalls, !tools.isEmpty {
                    WhisperToolCallsBlock(toolCalls: tools)
                }

                messageContent

                messageFooter
            }

            if message.role == .assistant { Spacer(minLength: 0) }
        }
    }

    // MARK: - Message Content

    fileprivate static let thumbSize = CGSize(width: 80, height: 60)
    fileprivate static let thumbRadius: CGFloat = 10

    @ViewBuilder
    private var messageContent: some View {
        // Image attachments (user messages only)
        if message.role == .user, let images = message.images, !images.isEmpty {
            HStack(spacing: 6) {
                ForEach(Array(images.enumerated()), id: \.offset) { _, img in
                    ImageThumb(attachment: img, resolveURL: resolveImageURL)
                }
            }
        }

        if !message.content.isEmpty {
            switch message.role {
            case .user:
                Text(message.content)
                    .font(.system(size: 14))
                    .foregroundStyle(WhisperColor.text)
                    .lineSpacing(3)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .glassEffect(.regular, in: userBubbleShape)
                    .overlay(
                        userBubbleShape
                            .stroke(WhisperColor.border, lineWidth: 1)
                    )
            case .assistant:
                Markdown(message.content)
                    .markdownTheme(.whisperChat)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            }
        }
    }

    // MARK: - User Bubble Shape

    private var userBubbleShape: UnevenRoundedRectangle {
        UnevenRoundedRectangle(
            topLeadingRadius: 14,
            bottomLeadingRadius: 14,
            bottomTrailingRadius: 4,
            topTrailingRadius: 14
        )
    }

    // MARK: - Message Footer

    @ViewBuilder
    private var messageFooter: some View {
        if message.id != "streaming" {
            HStack(alignment: .center, spacing: 4) {
                if message.cancelled == true {
                    HStack(spacing: 3) {
                        Image(systemName: "slash.circle")
                            .font(.system(size: 9))
                        Text("Cancelled")
                            .font(WhisperFont.mono(10))
                    }
                    .foregroundStyle(WhisperColor.textMuted)
                }

                Text(formatTimestamp(message.timestamp))
                    .font(WhisperFont.mono(10))
                    .foregroundStyle(WhisperColor.textMuted)

                if let ms = message.durationMs, message.role == .assistant {
                    Text("·")
                        .font(WhisperFont.mono(10))
                        .foregroundStyle(WhisperColor.textMuted)
                    Text(formatDuration(ms))
                        .font(WhisperFont.mono(10))
                        .foregroundStyle(WhisperColor.textMuted)
                }
            }
        }
    }

    // MARK: - Helpers

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

    private func formatTimestamp(_ ts: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: ts) else { return "" }
        let display = DateFormatter()
        display.timeStyle = .short
        return display.string(from: date)
    }

    private func formatDuration(_ ms: Int) -> String {
        if ms < 1000 { return "\(ms)ms" }
        let s = Double(ms) / 1000.0
        return String(format: "%.1fs", s)
    }
}

// MARK: - Image Thumbnail

private struct ImageThumb: View {
    let attachment: ImageAttachment
    let resolveURL: (String) -> URL?
    @State private var decoded: UIImage?
    @State private var failed = false

    private static let size = MessageBubble.thumbSize
    private static let radius = MessageBubble.thumbRadius

    var body: some View {
        Group {
            if let decoded {
                Image(uiImage: decoded)
                    .resizable()
                    .scaledToFill()
            } else if let url = resolveURL(attachment.dataUrl) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    case .failure:
                        failedPlaceholder
                    default:
                        ProgressView()
                    }
                }
            } else if failed {
                failedPlaceholder
            } else {
                ProgressView()
            }
        }
        .frame(width: Self.size.width, height: Self.size.height)
        .background(WhisperColor.toolIconBg)
        .clipShape(RoundedRectangle(cornerRadius: Self.radius))
        .task { decodeBase64IfNeeded() }
    }

    private var failedPlaceholder: some View {
        Image(systemName: "photo")
            .foregroundStyle(WhisperColor.textMuted)
    }

    private func decodeBase64IfNeeded() {
        guard attachment.dataUrl.hasPrefix("data:"),
              let range = attachment.dataUrl.range(of: ";base64,") else { return }
        let base64 = String(attachment.dataUrl[range.upperBound...])
        guard let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters),
              let image = UIImage(data: data) else {
            failed = true
            return
        }
        decoded = image
    }
}

// MARK: - Whisper Thinking Block

private struct WhisperThinkingBlock: View {
    let content: String
    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) { isExpanded.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "brain")
                        .font(.system(size: 9))
                        .frame(width: 12, height: 12)
                        .background(WhisperColor.toolIconBg, in: RoundedRectangle(cornerRadius: 3))
                        .foregroundStyle(WhisperColor.textMuted)

                    Text("Thinking")
                        .font(WhisperFont.mono(12))
                        .foregroundStyle(WhisperColor.textMuted)

                    Image(systemName: "chevron.right")
                        .font(.system(size: 8, weight: .medium))
                        .foregroundStyle(WhisperColor.textMuted)
                        .rotationEffect(.degrees(isExpanded ? 90 : 0))
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if isExpanded {
                Text(content)
                    .font(WhisperFont.mono(11))
                    .foregroundStyle(WhisperColor.textSecondary)
                    .lineSpacing(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.leading, 18)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }
}

// MARK: - Whisper Tool Calls Block

private struct WhisperToolCallsBlock: View {
    let toolCalls: [ToolCall]

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(topLevelCalls) { tool in
                WhisperToolCallRow(
                    tool: tool,
                    children: childCalls(for: tool.id)
                )
            }
        }
    }

    private var topLevelCalls: [ToolCall] {
        toolCalls.filter { $0.parentToolUseId == nil }
    }

    private func childCalls(for parentId: String) -> [ToolCall] {
        toolCalls.filter { $0.parentToolUseId == parentId }
    }
}

private struct WhisperToolCallRow: View {
    let tool: ToolCall
    let children: [ToolCall]
    @State private var isExpanded = false

    private var hasExpandableContent: Bool {
        (tool.output != nil && !tool.output!.isEmpty) || !children.isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                guard hasExpandableContent else { return }
                withAnimation(.easeInOut(duration: 0.2)) { isExpanded.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: iconName(for: tool.name))
                        .font(.system(size: 9))
                        .frame(width: 12, height: 12)
                        .background(WhisperColor.toolIconBg, in: RoundedRectangle(cornerRadius: 3))
                        .foregroundStyle(WhisperColor.textMuted)

                    Text(tool.name)
                        .font(WhisperFont.mono(12))
                        .foregroundStyle(WhisperColor.textMuted)

                    if !tool.input.isEmpty {
                        Text(tool.input.prefix(40))
                            .font(WhisperFont.mono(12))
                            .foregroundStyle(WhisperColor.textMuted.opacity(0.6))
                            .lineLimit(1)
                    }

                    Spacer()

                    if hasExpandableContent {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 8, weight: .medium))
                            .foregroundStyle(WhisperColor.textMuted)
                            .rotationEffect(.degrees(isExpanded ? 90 : 0))
                    }
                }
                .padding(.vertical, 2)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if isExpanded {
                VStack(alignment: .leading, spacing: 6) {
                    if let output = tool.output, !output.isEmpty {
                        Text(output)
                            .font(WhisperFont.mono(11))
                            .foregroundStyle(WhisperColor.textSecondary)
                            .lineLimit(20)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.top, 4)
                            .padding(.leading, 18)
                    }

                    ForEach(children) { child in
                        WhisperToolCallRow(tool: child, children: [])
                            .padding(.leading, 12)
                    }
                }
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
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

// MARK: - Whisper Chat Markdown Theme

private extension Theme {
    static let whisperChat = Theme.gitHub
        .text {
            BackgroundColor(.clear)
            ForegroundColor(Color(red: 0.91, green: 0.91, blue: 0.94))
            FontSize(14)
        }
        .code {
            FontFamilyVariant(.monospaced)
            FontSize(12)
            BackgroundColor(Color.white.opacity(0.05))
        }
}

// MARK: - Preview

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
            MessageBubble(message: ChatMessage(
                id: "3", sessionId: "s1", role: .assistant,
                content: "This was cancelled midway.",
                images: nil, toolCalls: nil, thinkingContent: nil,
                timestamp: "2026-02-17T12:01:00.000Z", cancelled: true, durationMs: 1500
            ))
        }
        .padding()
    }
    .preferredColorScheme(.dark)
}
