import MarkdownUI
import SwiftUI

struct MessageBubble: View {
    let message: ChatMessage
    var pendingToolUseIds: Set<String> = []
    var dismissedToolCallIds: Set<String> = []

    @AppStorage("hiveAccent") private var accentId = AccentOption.defaultId
    @State private var copied = false
    @State private var bubbleMenuVisible = false
    /// Scales the Markdown base font with Dynamic Type; the theme's relative
    /// (`.em`) sizes grow proportionally from it.
    @ScaledMetric(relativeTo: .body) private var markdownBaseSize: CGFloat = 14

    private var hiveAccent: Color {
        AccentOption(rawValue: accentId)?.color ?? AccentOption.violet.color
    }

    private var mergedToolCalls: [ToolCall] {
        mergeToolCalls(message.toolCalls ?? [], with: message.agentActivities ?? [])
    }

    private var visibleActivities: [VisibleAgentActivity] {
        visibleAgentActivities(message.agentActivities ?? [])
    }

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            if message.role == .user { Spacer(minLength: 60) }

            VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 6) {
                if let thinking = message.thinkingContent, !thinking.isEmpty {
                    WhisperThinkingBlock(content: thinking)
                }

                messageContent

                goalBadge

                let tools = mergedToolCalls
                if message.role == .assistant, !tools.isEmpty {
                    WhisperToolCallsBlock(
                        toolCalls: tools,
                        pendingToolUseIds: pendingToolUseIds,
                        dismissedToolCallIds: dismissedToolCallIds,
                        showExecutingState: message.id == "streaming"
                    )
                }

                let activities = visibleActivities
                if message.role == .assistant, !activities.isEmpty {
                    AgentActivityList(activities: activities, showExecutingState: message.id == "streaming")
                }

                messageFooter
            }

            if message.role == .assistant { Spacer(minLength: 40) }
        }
    }

    // MARK: - Message Content

    private static let thumbSize = CGSize(width: 80, height: 60)
    private static let thumbRadius: CGFloat = 10

    @ViewBuilder
    private var messageContent: some View {
        // Image attachments (user messages only)
        if message.role == .user, let images = message.images, !images.isEmpty {
            HStack(spacing: 6) {
                ForEach(Array(images.enumerated()), id: \.offset) { _, img in
                    ChatImageTileWithLightbox(
                        source: img.dataUrl,
                        size: Self.thumbSize,
                        cornerRadius: Self.thumbRadius
                    )
                }
            }
        }

        if message.role == .assistant, message.cancelled == true {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 4) {
                    Image(systemName: "stop.circle")
                        .font(.system(size: 11))
                    Text("Stopped")
                        .font(WhisperFont.scaled(13))
                        .italic()
                }
                .foregroundStyle(.red.opacity(0.7))

                if let detail = message.errorDetail, !detail.isEmpty {
                    Text(detail)
                        .font(WhisperFont.mono(10))
                        .foregroundStyle(.red.opacity(0.7))
                        .lineLimit(3)
                }
            }
        } else if !message.content.isEmpty {
            switch message.role {
            case .user:
                Text(highlightedUserContent(message.content, fileMentions: message.fileMentions))
                    .font(WhisperFont.scaled(14))
                    .foregroundStyle(WhisperColor.text)
                    .lineSpacing(3)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(
                        userBubbleShape.fill(hiveAccent.opacity(0.12))
                    )
                    .overlay(
                        userBubbleShape
                            .stroke(hiveAccent.opacity(0.24), lineWidth: 1)
                    )
                    .opacity(bubbleMenuVisible ? 0 : 1)
                    .overlay(
                        BubbleContextMenu(copyText: message.clipboardText) { visible in
                            bubbleMenuVisible = visible
                        }
                    )
            case .assistant:
                if message.id == "streaming" {
                    Markdown(message.content)
                        .markdownTextStyle { FontSize(markdownBaseSize) }
                        .markdownTheme(.whisperChat)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else if markdownNeedsRichRenderer(message.content) {
                    Markdown(message.content)
                        .markdownTextStyle { FontSize(markdownBaseSize) }
                        .markdownTheme(.whisperChat)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                } else {
                    SelectableMarkdownText(markdown: message.content)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    // MARK: - Goal Badge

    @ViewBuilder
    private var goalBadge: some View {
        if message.role == .user, message.goalCommand == true {
            HStack(spacing: 4) {
                Image(systemName: "target")
                    .font(.system(size: 9))
                Text("Sent with goal")
                    .font(WhisperFont.mono(10))
            }
            .foregroundStyle(WhisperColor.textMuted)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Capsule().fill(WhisperColor.surface))
            .overlay(Capsule().stroke(hiveAccent.opacity(0.15), lineWidth: 1))
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

                if message.role == .assistant, !message.content.isEmpty {
                    Text("·")
                        .font(WhisperFont.mono(10))
                        .foregroundStyle(WhisperColor.textMuted)
                    Button {
                        UIPasteboard.general.string = message.clipboardText
                        copied = true
                        Task {
                            try? await Task.sleep(for: .seconds(2))
                            copied = false
                        }
                    } label: {
                        Image(systemName: copied ? "checkmark" : "doc.on.doc")
                            .font(.system(size: 10))
                            .foregroundStyle(copied ? WhisperColor.success : WhisperColor.textMuted)
                            .contentTransition(.symbolEffect(.replace))
                            .frame(width: 14, height: 14)
                            .padding(.horizontal, 15)
                            .padding(.vertical, 12)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    // MARK: - Mention Highlighting

    @Environment(\.self) private var environment

    private func highlightedUserContent(_ content: String, fileMentions: [FileMention]?) -> AttributedString {
        var result = AttributedString(content)
        let accent = hiveAccent.resolve(in: environment)
        let accentUI = UIColor(red: CGFloat(accent.red), green: CGFloat(accent.green),
                               blue: CGFloat(accent.blue), alpha: CGFloat(accent.opacity))
        let bgColor = accentUI.withAlphaComponent(0.15)
        let fgColor = accentUI

        // Highlight #fileMentions using metadata
        if let mentions = fileMentions {
            for mention in mentions {
                let needle = "#\(mention.displayName)"
                var searchStart = result.startIndex
                while searchStart < result.endIndex,
                      let range = result[searchStart...].range(of: needle) {
                    result[range].backgroundColor = bgColor
                    result[range].foregroundColor = fgColor
                    searchStart = range.upperBound
                }
            }
        }

        // Highlight @mentions via regex (cursor-based to handle duplicates)
        if let regex = try? NSRegularExpression(pattern: #"(?:^|(?<=\s))@[\w][\w-]*"#) {
            let nsContent = content as NSString
            let matches = regex.matches(in: content, range: NSRange(location: 0, length: nsContent.length))
            var atCursor = result.startIndex
            for match in matches {
                guard let swiftRange = Range(match.range, in: content) else { continue }
                let needle = String(content[swiftRange])
                guard atCursor < result.endIndex,
                      let range = result[atCursor...].range(of: needle) else { continue }
                result[range].backgroundColor = bgColor
                result[range].foregroundColor = fgColor
                atCursor = range.upperBound
            }
        }

        return result
    }

    private static let isoWithFractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let iso: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        return formatter
    }()

    private func formatTimestamp(_ ts: String) -> String {
        guard let date = Self.isoWithFractional.date(from: ts) ?? Self.iso.date(from: ts) else { return "" }
        return Self.timeFormatter.string(from: date)
    }

}

// MARK: - Bubble Context Menu

/// UIKit-backed context menu for the user bubble. SwiftUI's `.contextMenu`
/// mis-places its dismiss preview inside List cells (the platter re-centers
/// horizontally in the row for the dismiss animation), so this owns both
/// targeted previews and anchors them to the bubble's real position.
private struct BubbleContextMenu: UIViewRepresentable {
    let copyText: String
    let onMenuVisibilityChange: (Bool) -> Void

    func makeUIView(context: Context) -> InteractionView {
        let view = InteractionView()
        view.backgroundColor = .clear
        view.addInteraction(UIContextMenuInteraction(delegate: view))
        return view
    }

    func updateUIView(_ uiView: InteractionView, context: Context) {
        uiView.copyText = copyText
        uiView.onMenuVisibilityChange = onMenuVisibilityChange
    }

    final class InteractionView: UIView, UIContextMenuInteractionDelegate {
        var copyText = ""
        var onMenuVisibilityChange: (Bool) -> Void = { _ in }
        private var snapshot: UIImage?

        func contextMenuInteraction(
            _ interaction: UIContextMenuInteraction,
            configurationForMenuAtLocation location: CGPoint
        ) -> UIContextMenuConfiguration? {
            snapshot = captureSnapshot()
            let copyText = copyText
            return UIContextMenuConfiguration(actionProvider: { _ in
                UIMenu(children: [
                    UIAction(title: "Copy", image: UIImage(systemName: "doc.on.doc")) { _ in
                        UIPasteboard.general.string = copyText
                    }
                ])
            })
        }

        func contextMenuInteraction(
            _ interaction: UIContextMenuInteraction,
            previewForHighlightingMenuWithConfiguration configuration: UIContextMenuConfiguration
        ) -> UITargetedPreview? {
            targetedPreview()
        }

        func contextMenuInteraction(
            _ interaction: UIContextMenuInteraction,
            previewForDismissingMenuWithConfiguration configuration: UIContextMenuConfiguration
        ) -> UITargetedPreview? {
            targetedPreview()
        }

        func contextMenuInteraction(
            _ interaction: UIContextMenuInteraction,
            willDisplayMenuFor configuration: UIContextMenuConfiguration,
            animator: UIContextMenuInteractionAnimating?
        ) {
            onMenuVisibilityChange(true)
        }

        func contextMenuInteraction(
            _ interaction: UIContextMenuInteraction,
            willEndFor configuration: UIContextMenuConfiguration,
            animator: UIContextMenuInteractionAnimating?
        ) {
            if let animator {
                animator.addCompletion { [onMenuVisibilityChange] in
                    onMenuVisibilityChange(false)
                }
            } else {
                onMenuVisibilityChange(false)
            }
        }

        private func captureSnapshot() -> UIImage? {
            guard let window, bounds.width > 0, bounds.height > 0 else { return nil }
            let rectInWindow = convert(bounds, to: window)
            let renderer = UIGraphicsImageRenderer(size: bounds.size)
            return renderer.image { context in
                context.cgContext.translateBy(x: -rectInWindow.minX, y: -rectInWindow.minY)
                window.drawHierarchy(in: window.bounds, afterScreenUpdates: false)
            }
        }

        private func targetedPreview() -> UITargetedPreview? {
            guard let snapshot else { return nil }
            let imageView = UIImageView(image: snapshot)
            imageView.frame = bounds
            let parameters = UIPreviewParameters()
            parameters.backgroundColor = .clear
            parameters.visiblePath = UIBezierPath(
                cgPath: UnevenRoundedRectangle(
                    topLeadingRadius: 14,
                    bottomLeadingRadius: 14,
                    bottomTrailingRadius: 4,
                    topTrailingRadius: 14
                ).path(in: bounds).cgPath
            )
            let target = UIPreviewTarget(container: self, center: CGPoint(x: bounds.midX, y: bounds.midY))
            return UITargetedPreview(view: imageView, parameters: parameters, target: target)
        }
    }
}

// MARK: - Tool Display Helpers

private struct ToolDisplay {
    let icon: String
    let label: String
    var detail: String?
    var hideOutput = false
    var badgeText: String?
    var badgeIcon: String?
    var overrideSummary: String?
    var stats: ChatActivityStats?
    var executing = false
}

private func toolIcon(for name: String) -> String {
    switch name {
    case "Read", "Write": return "doc.text"
    case "Edit": return "pencil"
    case "Bash": return "terminal"
    case "Grep", "Glob": return "magnifyingglass"
    case "Task", "Agent": return "arrow.triangle.branch"
    case "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TodoList": return "checklist"
    case "WebSearch", "WebFetch": return "globe"
    case "AskUserQuestion": return "bubble.left"
    default: return "wrench"
    }
}

private func getFilename(_ path: String) -> String {
    (path as NSString).lastPathComponent
}

/// Resolve file path across providers (Claude: file_path, Codex: filename).
private func resolveFilePath(_ input: [String: Any]) -> String? {
    (input["file_path"] ?? input["filename"]) as? String
}

/// Compute edit diff stats using prefix/suffix line matching.
private func computeEditDiffStats(oldString: String, newString: String) -> (added: Int, removed: Int) {
    let oldLines = oldString.split(separator: "\n", omittingEmptySubsequences: false)
    let newLines = newString.split(separator: "\n", omittingEmptySubsequences: false)
    // Common prefix
    var prefix = 0
    while prefix < oldLines.count && prefix < newLines.count && oldLines[prefix] == newLines[prefix] {
        prefix += 1
    }
    // Common suffix (not overlapping with prefix)
    var suffix = 0
    while suffix < oldLines.count - prefix && suffix < newLines.count - prefix
            && oldLines[oldLines.count - 1 - suffix] == newLines[newLines.count - 1 - suffix] {
        suffix += 1
    }
    let removed = oldLines.count - prefix - suffix
    let added = newLines.count - prefix - suffix
    return (added, removed)
}

private func computeToolStats(_ tool: ToolCall) -> ChatActivityStats? {
    guard let input = parsedToolInputObject(tool.input) else {
        return nil
    }

    switch tool.name {
    case "Edit":
        let oldString = input["old_string"] as? String
        let newString = input["new_string"] as? String
        let diff = input["diff"] as? String
        if let diff, !diff.isEmpty {
            let stats = parseDiffStats(diff)
            guard stats.added > 0 || stats.removed > 0 else { return nil }
            return ChatActivityStats(kind: .diff, added: stats.added, removed: stats.removed)
        }
        guard (oldString != nil && !oldString!.isEmpty) || (newString != nil && !newString!.isEmpty) else { return nil }
        let stats = computeEditDiffStats(oldString: oldString ?? "", newString: newString ?? "")
        guard stats.added > 0 || stats.removed > 0 else { return nil }
        return ChatActivityStats(kind: .diff, added: stats.added, removed: stats.removed)

    case "Write":
        guard let content = input["content"] as? String, !content.isEmpty else { return nil }
        let lineCount = content.components(separatedBy: "\n").count
        return ChatActivityStats(kind: .diff, added: lineCount, removed: 0)

    case "Grep":
        guard let output = tool.output, !output.isEmpty else { return nil }
        let lines = output.split(separator: "\n", omittingEmptySubsequences: true)
        guard !lines.isEmpty else { return nil }
        return ChatActivityStats(kind: .plain, label: "\(lines.count) result\(lines.count != 1 ? "s" : "")")

    case "Glob":
        guard let output = tool.output, !output.isEmpty else { return nil }
        let lines = output.split(separator: "\n", omittingEmptySubsequences: true)
        guard !lines.isEmpty else { return nil }
        return ChatActivityStats(kind: .plain, label: "\(lines.count) file\(lines.count != 1 ? "s" : "")")

    default:
        return nil
    }
}

private func getToolDisplay(
    _ tool: ToolCall,
    children: [ToolCall] = [],
    childrenByParentId: [String: [ToolCall]] = [:],
    isPending: Bool = false,
    isDismissed: Bool = false,
    showExecutingState: Bool = false
) -> ToolDisplay {
    guard let input = parsedToolInputObject(tool.input) else {
        return ToolDisplay(icon: toolIcon(for: tool.name), label: tool.name, detail: String(tool.input.prefix(40)))
    }

    switch tool.name {
    case "Read":
        let filePath = resolveFilePath(input)
        let limit = input["limit"] as? Int
        let label = limit != nil ? "Read \(limit!) lines" : "Read"
        return ToolDisplay(icon: "doc.text", label: label, detail: filePath.map(getFilename))

    case "Edit":
        let filePath = resolveFilePath(input)
        var display = ToolDisplay(icon: "pencil", label: "Edit", detail: filePath.map(getFilename), hideOutput: true)
        display.stats = computeToolStats(tool)
        return display

    case "Write":
        let filePath = resolveFilePath(input)
        var display = ToolDisplay(icon: "doc.text", label: "Write", detail: filePath.map(getFilename))
        display.stats = computeToolStats(tool)
        return display

    case "Bash":
        let command = input["command"] as? String
        let truncated = command.map { $0.count > 50 ? String($0.prefix(50)) + "..." : $0 }
        return ToolDisplay(icon: "terminal", label: "Bash", detail: truncated)

    case "Grep":
        let pattern = input["pattern"] as? String
        let path = input["path"] as? String
        var detail = pattern.map { "\"\($0)\"" }
        if let path { detail = (detail ?? "") + " in \(getFilename(path))" }
        var grepDisplay = ToolDisplay(icon: "magnifyingglass", label: "Grep", detail: detail)
        grepDisplay.stats = computeToolStats(tool)
        return grepDisplay

    case "Glob":
        let pattern = input["pattern"] as? String
        var globDisplay = ToolDisplay(icon: "magnifyingglass", label: "Glob", detail: pattern)
        globDisplay.stats = computeToolStats(tool)
        return globDisplay

    case "Task", "Agent":
        let subagentType = input["subagent_type"] as? String
        let description = input["description"] as? String
        let label = tool.name == "Agent"
            ? (subagentType ?? "Agent")
            : (subagentType.map { "Task (\($0))" } ?? "Task")
        let state = subAgentExecutionState(
            for: tool,
            children: children,
            childrenByParentId: childrenByParentId,
            showExecutingState: showExecutingState
        )
        var display = ToolDisplay(icon: "arrow.triangle.branch", label: label, detail: description)
        display.executing = state == .running
        if state == .failed {
            display.badgeText = "FAILED"
            display.badgeIcon = "exclamationmark.triangle"
        }
        return display

    case "WebFetch", "WebSearch":
        let url = input["url"] as? String
        let query = input["query"] as? String
        return ToolDisplay(icon: "globe", label: tool.name, detail: url ?? query)

    case "AskUserQuestion":
        let questions = (input["questions"] as? [[String: Any]]) ?? []
        let count = questions.count
        let badgeText = isPending ? "WAITING" : (isDismissed ? "CANCELLED" : "ANSWERED")
        let badgeIcon = isPending ? "clock" : (isDismissed ? "xmark.circle" : "checkmark.circle")
        return ToolDisplay(
            icon: "bubble.left",
            label: "User input",
            hideOutput: true,
            badgeText: badgeText,
            badgeIcon: badgeIcon,
            overrideSummary: count > 0 ? "\(count) question\(count != 1 ? "s" : "")" : nil
        )

    case "TaskCreate":
        let subject = input["subject"] as? String
        return ToolDisplay(icon: "checklist", label: "TaskCreate", detail: subject)

    case "TaskUpdate":
        let taskId = input["taskId"] as? String
        let status = input["status"] as? String
        let parts = [taskId.map { "#\($0)" }, status].compactMap { $0 }
        let detail = parts.isEmpty ? nil : parts.joined(separator: " → ")
        return ToolDisplay(icon: "checklist", label: "TaskUpdate", detail: detail)

    case "TaskList":
        return ToolDisplay(icon: "checklist", label: "TaskList")

    case "TaskGet":
        let taskId = input["taskId"] as? String
        return ToolDisplay(icon: "checklist", label: "TaskGet", detail: taskId.map { "#\($0)" })

    case "TodoList":
        let items = input["items"] as? [[String: Any]] ?? []
        let completed = items.filter { ($0["completed"] as? Bool) == true }.count
        return ToolDisplay(icon: "checklist", label: "TodoList", detail: "\(completed)/\(items.count) complete")

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
                isExpanded.toggle()
            } label: {
                ChatActivityRowLabel(icon: "brain", label: "Thinking", detail: isExpanded ? nil : preview)
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
            }
        }
    }
}

// MARK: - Whisper Tool Calls Block

private let collapseThreshold = 3
private let hiddenTaskToolNames: Set<String> = ["TaskUpdate", "TodoList"]

private struct ToolCallTree {
    let rootTools: [ToolCall]
    let childrenByParentId: [String: [ToolCall]]

    init(toolCalls: [ToolCall]) {
        let visibleTools = toolCalls.filter { !hiddenTaskToolNames.contains($0.name) }
        rootTools = visibleTools.filter { $0.parentToolUseId == nil }
        childrenByParentId = buildChildrenMap(visibleTools)
    }
}

private struct WhisperToolCallsBlock: View {
    let toolCalls: [ToolCall]
    var pendingToolUseIds: Set<String> = []
    var dismissedToolCallIds: Set<String> = []
    var showExecutingState = false
    @State private var groupExpanded = false

    var body: some View {
        let tree = ToolCallTree(toolCalls: toolCalls)
        let shouldCollapse = tree.rootTools.count >= collapseThreshold

        VStack(alignment: .leading, spacing: 2) {
            if shouldCollapse {
                CollapsedToolSummary(
                    tools: tree.rootTools,
                    isExpanded: groupExpanded,
                    isStreaming: showExecutingState,
                    onToggle: {
                        groupExpanded.toggle()
                    }
                )
            }

            if !shouldCollapse || groupExpanded {
                ForEach(tree.rootTools) { tool in
                    WhisperToolCallRow(
                        tool: tool,
                        children: tree.childrenByParentId[tool.id] ?? [],
                        childrenByParentId: tree.childrenByParentId,
                        isPending: pendingToolUseIds.contains(tool.id),
                        isDismissed: dismissedToolCallIds.contains(tool.id),
                        showExecutingState: showExecutingState
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
    let isStreaming: Bool
    let onToggle: () -> Void

    private var summaryLabel: String {
        let subagentCount = tools.filter { $0.name == "Task" || $0.name == "Agent" }.count
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
            ChatActivityRowLabel(
                label: summaryLabel,
                isExpanded: isExpanded,
                accessoryIcons: uniqueIcons,
                executing: isStreaming
            )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Tool Call Row

private struct WhisperToolCallRow: View {
    let tool: ToolCall
    let children: [ToolCall]
    let childrenByParentId: [String: [ToolCall]]
    var isPending = false
    var isDismissed = false
    var showExecutingState = false
    @State private var isExpanded = false

    var body: some View {
        let display = getToolDisplay(
            tool,
            children: children,
            childrenByParentId: childrenByParentId,
            isPending: isPending,
            isDismissed: isDismissed,
            showExecutingState: showExecutingState
        )
        let summary = !isExpanded && display.stats == nil ? (display.overrideSummary ?? getOutputSummary(tool)) : nil

        VStack(alignment: .leading, spacing: 0) {
            Button {
                isExpanded.toggle()
            } label: {
                ChatActivityRowLabel(icon: display.icon, label: display.label, detail: display.detail, stats: display.stats, summary: summary, badgeText: display.badgeText, badgeIcon: display.badgeIcon, executing: display.executing)
            }
            .buttonStyle(.plain)

            if isExpanded {
                VStack(alignment: .leading, spacing: 0) {
                    if tool.name == "Edit" || tool.name == "Write" {
                        DiffContentView(tool: tool)
                    } else if tool.name == "AskUserQuestion" {
                        AskUserQuestionContent(tool: tool)
                    } else if let output = tool.output, !output.isEmpty, !display.hideOutput {
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
                                WhisperToolCallRow(
                                    tool: child,
                                    children: childrenByParentId[child.id] ?? [],
                                    childrenByParentId: childrenByParentId,
                                    showExecutingState: showExecutingState
                                )
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
            }
        }
    }
}

// MARK: - Diff Content View (Edit tool expanded)

/// Compute display-ready diff lines from old/new strings.
private func computeDiffLines(oldString: String, newString: String) -> [DiffLine] {
    let oldLines = oldString.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    let newLines = newString.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)

    // Common prefix
    var pfx = 0
    while pfx < oldLines.count && pfx < newLines.count && oldLines[pfx] == newLines[pfx] {
        pfx += 1
    }
    // Common suffix (not overlapping with prefix)
    var sfx = 0
    while sfx < oldLines.count - pfx && sfx < newLines.count - pfx
            && oldLines[oldLines.count - 1 - sfx] == newLines[newLines.count - 1 - sfx] {
        sfx += 1
    }

    var result: [DiffLine] = []
    var idx = 0

    // Prefix context (show last 3 lines max)
    let ctxBefore = max(0, pfx - 3)
    for i in ctxBefore..<pfx {
        result.append(DiffLine(id: idx, kind: .context, text: oldLines[i])); idx += 1
    }
    // Removed lines
    for i in pfx..<(oldLines.count - sfx) {
        result.append(DiffLine(id: idx, kind: .removed, text: oldLines[i])); idx += 1
    }
    // Added lines
    for i in pfx..<(newLines.count - sfx) {
        result.append(DiffLine(id: idx, kind: .added, text: newLines[i])); idx += 1
    }
    // Suffix context (show first 3 lines max)
    let ctxAfter = min(sfx, 3)
    for i in 0..<ctxAfter {
        let lineIdx = oldLines.count - sfx + i
        result.append(DiffLine(id: idx, kind: .context, text: oldLines[lineIdx])); idx += 1
    }

    return result
}

private struct DiffContentView: View {
    let tool: ToolCall
    private let parsed: (filePath: String?, lines: [DiffLine])

    init(tool: ToolCall) {
        self.tool = tool
        self.parsed = DiffContentView.buildParsed(tool)
    }

    private static func buildParsed(_ tool: ToolCall) -> (filePath: String?, lines: [DiffLine]) {
        guard let input = parsedToolInputObject(tool.input) else {
            return (nil, [])
        }
        let filePath = resolveFilePath(input)

        // Write tool: all-new content
        if let content = input["content"] as? String, !content.isEmpty {
            let lines = content.split(separator: "\n", omittingEmptySubsequences: false)
            let diffLines = lines.enumerated().map { DiffLine(id: $0.offset, kind: .added, text: String($0.element)) }
            return (filePath, diffLines)
        }

        // Codex format: unified diff string
        if let diff = input["diff"] as? String, !diff.isEmpty {
            return (filePath, parseUnifiedDiffLines(diff))
        }
        // Claude format: old_string + new_string
        let oldString = input["old_string"] as? String ?? ""
        let newString = input["new_string"] as? String ?? ""
        return (filePath, computeDiffLines(oldString: oldString, newString: newString))
    }

    var body: some View {
        let result = parsed

        ToolContentPanel {
            VStack(alignment: .leading, spacing: 0) {
                if let path = result.filePath {
                    Text(path)
                        .font(WhisperFont.mono(10))
                        .foregroundStyle(WhisperColor.textMuted)
                        .lineLimit(1)
                        .padding(.bottom, 6)
                }

                DiffLinesView(lines: result.lines)
            }
        }
    }
}

// MARK: - AskUserQuestion Expanded Content

private struct AskUserQuestionContent: View {
    let tool: ToolCall

    private var questions: [(text: String, options: [String])] {
        guard let input = parsedToolInputObject(tool.input),
              let arr = input["questions"] as? [[String: Any]] else {
            return []
        }
        return arr.enumerated().map { idx, q in
            let text = q["question"] as? String ?? "Question \(idx + 1)"
            let options = (q["options"] as? [[String: Any]])?.compactMap { $0["label"] as? String } ?? []
            return (text: text, options: options)
        }
    }

    var body: some View {
        ToolContentPanel {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(Array(questions.enumerated()), id: \.offset) { _, q in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(q.text)
                            .font(WhisperFont.scaled(12, weight: .medium))
                            .foregroundStyle(WhisperColor.textSecondary)
                        ForEach(q.options, id: \.self) { option in
                            HStack(spacing: 5) {
                                Circle()
                                    .stroke(WhisperColor.textMuted, lineWidth: 1)
                                    .frame(width: 6, height: 6)
                                Text(option)
                                    .font(WhisperFont.mono(11))
                                    .foregroundStyle(WhisperColor.textMuted)
                            }
                        }
                    }
                }
            }
        }
    }
}

// MARK: - Whisper Chat Markdown Theme

private let whisperLinkColor = Color.accentColor

private extension Theme {
    static let whisperChat = Theme.gitHub
        // ── Inline text ──
        .text {
            BackgroundColor(.clear)
            ForegroundColor(WhisperColor.text)
        }
        .code {
            FontFamilyVariant(.monospaced)
            FontSize(.em(12.0 / 14))
            ForegroundColor(WhisperColor.codeText)
            BackgroundColor(WhisperColor.codeBg)
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
                    FontSize(.em(20.0 / 14))
                }
        }
        .heading2 { configuration in
            configuration.label
                .relativeLineSpacing(.em(0.04))
                .markdownMargin(top: .em(1), bottom: .em(0.3))
                .markdownTextStyle {
                    FontWeight(.semibold)
                    FontSize(.em(17.0 / 14))
                }
        }
        .heading3 { configuration in
            configuration.label
                .relativeLineSpacing(.em(0.04))
                .markdownMargin(top: .em(0.8), bottom: .em(0.2))
                .markdownTextStyle {
                    FontWeight(.semibold)
                    FontSize(.em(15.0 / 14))
                }
        }
        .heading4 { configuration in
            configuration.label
                .markdownMargin(top: .em(0.6), bottom: .em(0.2))
                .markdownTextStyle {
                    FontWeight(.medium)
                    FontSize(.em(1.0))
                }
        }
        .heading5 { configuration in
            configuration.label
                .markdownMargin(top: .em(0.5), bottom: .em(0.1))
                .markdownTextStyle {
                    FontWeight(.medium)
                    FontSize(.em(13.0 / 14))
                    ForegroundColor(WhisperColor.textSecondary)
                }
        }
        .heading6 { configuration in
            configuration.label
                .markdownMargin(top: .em(0.5), bottom: .em(0.1))
                .markdownTextStyle {
                    FontWeight(.medium)
                    FontSize(.em(12.0 / 14))
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
                FontSize(.em(12.0 / 14))
                ForegroundColor(WhisperColor.codeText)
            }
            .padding(12)
            .background(WhisperColor.codeBlockBg, in: RoundedRectangle(cornerRadius: 8))
            .markdownMargin(top: .em(0.4), bottom: .em(0.4))
        }
        // ── Blockquotes ──
        .blockquote { configuration in
            HStack(spacing: 0) {
                RoundedRectangle(cornerRadius: 1)
                    .fill(WhisperColor.border)
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
                .overlay(WhisperColor.separator)
                .markdownMargin(top: .em(0.8), bottom: .em(0.8))
        }
}

// MARK: - Preview

#Preview {
    ScrollView {
        VStack(spacing: 16) {
            MessageBubble(message: ChatMessage(
                id: "1", sessionId: "s1", role: .user,
                content: "Can you fix the login bug in #auth.ts? Ask @claude-code if needed",
                images: nil,
                fileMentions: [FileMention(displayName: "auth.ts", relativePath: "src/utils/auth.ts")],
                toolCalls: nil, thinkingContent: nil,
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
