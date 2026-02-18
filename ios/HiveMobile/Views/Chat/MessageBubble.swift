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
    @State private var image: UIImage?
    @State private var failed = false

    private static let size = MessageBubble.thumbSize
    private static let radius = MessageBubble.thumbRadius

    init(attachment: ImageAttachment, resolveURL: @escaping (String) -> URL?) {
        self.attachment = attachment
        self.resolveURL = resolveURL
        let key = ImageCache.key(for: attachment.dataUrl)
        _image = State(initialValue: ImageCache.shared.image(forKey: key))
    }

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else if failed {
                failedPlaceholder
            } else {
                ProgressView()
            }
        }
        .frame(width: Self.size.width, height: Self.size.height)
        .background(WhisperColor.toolIconBg)
        .clipShape(RoundedRectangle(cornerRadius: Self.radius))
        .task { await loadImage() }
    }

    private var failedPlaceholder: some View {
        Image(systemName: "photo")
            .foregroundStyle(WhisperColor.textMuted)
    }

    private func loadImage() async {
        guard image == nil else { return }
        let key = ImageCache.key(for: attachment.dataUrl)

        if attachment.dataUrl.hasPrefix("data:") {
            guard let range = attachment.dataUrl.range(of: ";base64,") else {
                failed = true
                return
            }
            let base64 = String(attachment.dataUrl[range.upperBound...])
            guard let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters),
                  let decoded = UIImage(data: data) else {
                failed = true
                return
            }
            ImageCache.shared.storeThumbnail(decoded, forKey: key, maxSize: Self.size)
            image = ImageCache.shared.image(forKey: key)
            return
        }

        guard let url = resolveURL(attachment.dataUrl) else {
            failed = true
            return
        }

        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            guard let decoded = UIImage(data: data) else {
                failed = true
                return
            }
            ImageCache.shared.storeThumbnail(decoded, forKey: key, maxSize: Self.size)
            image = ImageCache.shared.image(forKey: key)
        } catch {
            failed = true
        }
    }
}

// MARK: - Tool Display Helpers

private struct ToolDisplay {
    let icon: String
    let label: String
    var detail: String?
    var hideOutput = false
}

private func toolIcon(for name: String) -> String {
    switch name {
    case "Read", "Write": return "doc.text"
    case "Edit": return "pencil"
    case "Bash": return "terminal"
    case "Grep", "Glob": return "magnifyingglass"
    case "Task": return "arrow.triangle.branch"
    case "WebSearch", "WebFetch": return "globe"
    default: return "wrench"
    }
}

private func getFilename(_ path: String) -> String {
    (path as NSString).lastPathComponent
}

private func getToolDisplay(_ tool: ToolCall) -> ToolDisplay {
    guard let data = tool.input.data(using: .utf8),
          let input = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        return ToolDisplay(icon: toolIcon(for: tool.name), label: tool.name, detail: String(tool.input.prefix(40)))
    }

    switch tool.name {
    case "Read":
        let filePath = input["file_path"] as? String
        let limit = input["limit"] as? Int
        let label = limit != nil ? "Read \(limit!) lines" : "Read"
        return ToolDisplay(icon: "doc.text", label: label, detail: filePath.map(getFilename))

    case "Edit":
        let filePath = input["file_path"] as? String
        return ToolDisplay(icon: "pencil", label: "Edit", detail: filePath.map(getFilename), hideOutput: true)

    case "Write":
        let filePath = input["file_path"] as? String
        return ToolDisplay(icon: "doc.text", label: "Write", detail: filePath.map(getFilename))

    case "Bash":
        let command = input["command"] as? String
        let truncated = command.map { $0.count > 50 ? String($0.prefix(50)) + "..." : $0 }
        return ToolDisplay(icon: "terminal", label: "Bash", detail: truncated)

    case "Grep":
        let pattern = input["pattern"] as? String
        let path = input["path"] as? String
        var detail = pattern.map { "\"\($0)\"" }
        if let path { detail = (detail ?? "") + " in \(getFilename(path))" }
        return ToolDisplay(icon: "magnifyingglass", label: "Grep", detail: detail)

    case "Glob":
        let pattern = input["pattern"] as? String
        return ToolDisplay(icon: "magnifyingglass", label: "Glob", detail: pattern)

    case "Task":
        let subagentType = input["subagent_type"] as? String
        let description = input["description"] as? String
        let label = subagentType != nil ? "Task (\(subagentType!))" : "Task"
        return ToolDisplay(icon: "arrow.triangle.branch", label: label, detail: description)

    case "WebFetch", "WebSearch":
        let url = input["url"] as? String
        let query = input["query"] as? String
        return ToolDisplay(icon: "globe", label: tool.name, detail: url ?? query)

    default:
        return ToolDisplay(icon: toolIcon(for: tool.name), label: tool.name)
    }
}

private func getOutputSummary(_ tool: ToolCall) -> String? {
    guard let output = tool.output, !output.isEmpty else { return nil }
    let lines = output.split(separator: "\n", omittingEmptySubsequences: true)
    if lines.count == 1, lines[0].count < 60 { return String(lines[0]) }
    if lines.count > 1 { return "\(lines.count) lines" }
    return nil
}

// MARK: - Whisper Thinking Block

private struct WhisperThinkingBlock: View {
    let content: String
    @State private var isExpanded = false

    private var preview: String {
        let first = content.prefix(40).replacingOccurrences(of: "\n", with: " ")
        return content.count > 40 ? first + "..." : String(first)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) { isExpanded.toggle() }
            } label: {
                ToolRowLabel(icon: "brain", label: "Thinking", detail: isExpanded ? nil : preview)
            }
            .buttonStyle(.plain)

            if isExpanded {
                ToolContentPanel {
                    Text(content)
                        .font(WhisperFont.mono(11))
                        .foregroundStyle(WhisperColor.textSecondary)
                        .lineSpacing(2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }
}

// MARK: - Whisper Tool Calls Block

private let collapseThreshold = 3

private struct WhisperToolCallsBlock: View {
    let toolCalls: [ToolCall]
    @State private var groupExpanded = false

    private var rootTools: [ToolCall] {
        toolCalls.filter { $0.parentToolUseId == nil }
    }

    private func children(for parentId: String) -> [ToolCall] {
        toolCalls.filter { $0.parentToolUseId == parentId }
    }

    private var shouldCollapse: Bool {
        rootTools.count >= collapseThreshold
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if shouldCollapse {
                CollapsedToolSummary(
                    tools: rootTools,
                    isExpanded: groupExpanded,
                    onToggle: {
                        withAnimation(.easeInOut(duration: 0.2)) { groupExpanded.toggle() }
                    }
                )
            }

            if !shouldCollapse || groupExpanded {
                ForEach(rootTools) { tool in
                    WhisperToolCallRow(
                        tool: tool,
                        children: children(for: tool.id)
                    )
                }
            }
        }
    }
}

// MARK: - Collapsed Tool Summary

private struct CollapsedToolSummary: View {
    let tools: [ToolCall]
    let isExpanded: Bool
    let onToggle: () -> Void

    private var summaryLabel: String {
        let subagentCount = tools.filter { $0.name == "Task" }.count
        let toolCount = tools.count - subagentCount
        var parts: [String] = []
        if toolCount > 0 { parts.append("\(toolCount) tool call\(toolCount != 1 ? "s" : "")") }
        if subagentCount > 0 { parts.append("\(subagentCount) subagent\(subagentCount != 1 ? "s" : "")") }
        return parts.joined(separator: ", ")
    }

    private var uniqueIcons: [String] {
        var seen = Set<String>()
        return tools.compactMap { tool in
            let icon = toolIcon(for: tool.name)
            return seen.insert(icon).inserted ? icon : nil
        }
    }

    var body: some View {
        Button(action: onToggle) {
            HStack(spacing: 6) {
                Image(systemName: "chevron.right")
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(WhisperColor.textMuted)
                    .rotationEffect(.degrees(isExpanded ? 90 : 0))

                Text(summaryLabel)
                    .font(WhisperFont.mono(12))
                    .foregroundStyle(WhisperColor.textMuted)

                HStack(spacing: 3) {
                    ForEach(uniqueIcons, id: \.self) { icon in
                        Image(systemName: icon)
                            .font(.system(size: 9))
                            .foregroundStyle(WhisperColor.textMuted)
                    }
                }
            }
            .padding(.vertical, 3)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Tool Call Row

private struct WhisperToolCallRow: View {
    let tool: ToolCall
    let children: [ToolCall]
    @State private var isExpanded = false

    var body: some View {
        let display = getToolDisplay(tool)
        let summary = !isExpanded ? getOutputSummary(tool) : nil

        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) { isExpanded.toggle() }
            } label: {
                ToolRowLabel(icon: display.icon, label: display.label, detail: display.detail, summary: summary)
            }
            .buttonStyle(.plain)

            if isExpanded {
                VStack(alignment: .leading, spacing: 0) {
                    if let output = tool.output, !output.isEmpty, !display.hideOutput {
                        ToolContentPanel {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("OUTPUT")
                                    .font(WhisperFont.mono(9))
                                    .foregroundStyle(WhisperColor.textMuted)
                                    .tracking(1)
                                Text(output)
                                    .font(WhisperFont.mono(11))
                                    .foregroundStyle(WhisperColor.textSecondary)
                                    .lineLimit(20)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                    }

                    if !children.isEmpty {
                        VStack(alignment: .leading, spacing: 2) {
                            ForEach(children) { child in
                                WhisperToolCallRow(tool: child, children: [])
                            }
                        }
                        .padding(.leading, 14)
                        .overlay(alignment: .leading) {
                            Rectangle()
                                .fill(WhisperColor.textMuted.opacity(0.15))
                                .frame(width: 2)
                                .padding(.leading, 5)
                        }
                    }
                }
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }
}

// MARK: - Shared Tool Row Components

private struct ToolRowLabel: View {
    let icon: String
    let label: String
    var detail: String?
    var summary: String?

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 9))
                .frame(width: 14, height: 14)
                .foregroundStyle(WhisperColor.textMuted)

            Text(label)
                .font(WhisperFont.mono(12))
                .foregroundStyle(WhisperColor.textMuted)

            if let detail {
                Text(detail)
                    .font(WhisperFont.mono(11))
                    .foregroundStyle(WhisperColor.textSecondary)
                    .lineLimit(1)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color.white.opacity(0.10), in: RoundedRectangle(cornerRadius: 4))
            }

            if let summary {
                Text(summary)
                    .font(WhisperFont.mono(10))
                    .foregroundStyle(WhisperColor.textMuted)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 3)
        .contentShape(Rectangle())
    }
}

private struct ToolContentPanel<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        content
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
            .padding(.top, 2)
    }
}

// MARK: - Whisper Chat Markdown Theme

private let whisperCodeColor = Color(red: 0.78, green: 0.82, blue: 0.90)
private let whisperLinkColor = Color(red: 0.231, green: 0.510, blue: 0.965)

private extension Theme {
    static let whisperChat = Theme.gitHub
        // ── Inline text ──
        .text {
            BackgroundColor(.clear)
            ForegroundColor(WhisperColor.text)
            FontSize(14)
        }
        .code {
            FontFamilyVariant(.monospaced)
            FontSize(12)
            ForegroundColor(whisperCodeColor)
            BackgroundColor(Color.white.opacity(0.10))
        }
        .strong {
            FontWeight(.semibold)
        }
        .emphasis {
            FontStyle(.italic)
        }
        .link {
            ForegroundColor(whisperLinkColor)
        }
        .strikethrough {
            StrikethroughStyle(.single)
            ForegroundColor(WhisperColor.textSecondary)
        }
        // ── Headings ──
        .heading1 { configuration in
            configuration.label
                .relativeLineSpacing(.em(0.04))
                .markdownMargin(top: .em(1.2), bottom: .em(0.4))
                .markdownTextStyle {
                    FontWeight(.semibold)
                    FontSize(20)
                }
        }
        .heading2 { configuration in
            configuration.label
                .relativeLineSpacing(.em(0.04))
                .markdownMargin(top: .em(1), bottom: .em(0.3))
                .markdownTextStyle {
                    FontWeight(.semibold)
                    FontSize(17)
                }
        }
        .heading3 { configuration in
            configuration.label
                .relativeLineSpacing(.em(0.04))
                .markdownMargin(top: .em(0.8), bottom: .em(0.2))
                .markdownTextStyle {
                    FontWeight(.semibold)
                    FontSize(15)
                }
        }
        .heading4 { configuration in
            configuration.label
                .markdownMargin(top: .em(0.6), bottom: .em(0.2))
                .markdownTextStyle {
                    FontWeight(.medium)
                    FontSize(14)
                }
        }
        .heading5 { configuration in
            configuration.label
                .markdownMargin(top: .em(0.5), bottom: .em(0.1))
                .markdownTextStyle {
                    FontWeight(.medium)
                    FontSize(13)
                    ForegroundColor(WhisperColor.textSecondary)
                }
        }
        .heading6 { configuration in
            configuration.label
                .markdownMargin(top: .em(0.5), bottom: .em(0.1))
                .markdownTextStyle {
                    FontWeight(.medium)
                    FontSize(12)
                    ForegroundColor(WhisperColor.textSecondary)
                }
        }
        // ── Code blocks ──
        .codeBlock { configuration in
            ScrollView(.horizontal) {
                configuration.label
                    .fixedSize(horizontal: true, vertical: false)
            }
            .scrollIndicators(.hidden)
            .markdownTextStyle {
                FontFamilyVariant(.monospaced)
                FontSize(12)
                ForegroundColor(whisperCodeColor)
            }
            .padding(12)
            .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
            .markdownMargin(top: .em(0.4), bottom: .em(0.4))
        }
        // ── Blockquotes ──
        .blockquote { configuration in
            HStack(spacing: 0) {
                RoundedRectangle(cornerRadius: 1)
                    .fill(Color.white.opacity(0.15))
                    .frame(width: 3)
                configuration.label
                    .markdownTextStyle {
                        ForegroundColor(WhisperColor.textSecondary)
                    }
                    .padding(.leading, 12)
            }
            .markdownMargin(top: .em(0.4), bottom: .em(0.4))
        }
        // ── Thematic break ──
        .thematicBreak {
            Divider()
                .overlay(Color.white.opacity(0.10))
                .markdownMargin(top: .em(0.8), bottom: .em(0.8))
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
                content: """
                I'll look into the **authentication flow**. Let me check the relevant files.

                ### Changes Made

                Updated `auth.swift` with proper error handling:

                ```swift
                func login() async throws {
                    let token = getToken()
                    try await validate(token)
                }
                ```

                > Note: The `validate` function now throws on invalid tokens.

                Key improvements:
                - Added `async/await` support
                - Proper *error propagation*
                - See [Swift Concurrency docs](https://docs.swift.org) for details
                """,
                images: nil,
                toolCalls: [
                    ToolCall(id: "t1", name: "Read", input: "{\"file_path\":\"/src/auth.swift\",\"limit\":77}", output: "func login() {\n    let token = getToken()\n    validate(token)\n}", parentToolUseId: nil),
                    ToolCall(id: "t2", name: "Edit", input: "{\"file_path\":\"/src/auth.swift\",\"old_string\":\"validate(token)\",\"new_string\":\"try await validate(token)\"}", output: "OK", parentToolUseId: nil),
                    ToolCall(id: "t3", name: "Bash", input: "{\"command\":\"swift build\"}", output: "Build complete! (0.45s)", parentToolUseId: nil),
                    ToolCall(id: "t4", name: "Grep", input: "{\"pattern\":\"loginError\",\"path\":\"/src/auth.swift\"}", output: "src/auth.swift:42: case loginError\nsrc/auth.swift:88: throw loginError", parentToolUseId: nil),
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
