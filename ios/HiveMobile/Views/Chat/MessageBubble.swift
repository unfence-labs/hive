import MarkdownUI
import SwiftUI

struct MessageBubble: View, Equatable {
    let message: ChatMessage
    var isStreaming = false
    var pendingToolUseIds: Set<String> = []
    var dismissedToolCallIds: Set<String> = []
    var sendState: ConversationStore.UserSendState? = nil
    var findHighlight: MessageFindHighlight? = nil
    var onRetrySend: (() -> Void)? = nil
    var onDiscardSend: (() -> Void)? = nil

    static func == (lhs: MessageBubble, rhs: MessageBubble) -> Bool {
        lhs.message == rhs.message
            && lhs.isStreaming == rhs.isStreaming
            && lhs.pendingToolUseIds == rhs.pendingToolUseIds
            && lhs.dismissedToolCallIds == rhs.dismissedToolCallIds
            && lhs.sendState == rhs.sendState
            && lhs.findHighlight == rhs.findHighlight
    }

    @AppStorage("hiveAccent") private var accentId = AccentOption.defaultId
    @State private var copied = false
    @State private var bubbleMenuVisible = false
    /// Scales the Markdown base font with Dynamic Type; the theme's relative
    /// (`.em`) sizes grow proportionally from it.
    @ScaledMetric(relativeTo: .body) private var markdownBaseSize: CGFloat = 14

    private var hiveAccent: Color {
        AccentOption(rawValue: accentId)?.color ?? AccentOption.violet.color
    }

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            if message.role == .user { Spacer(minLength: 60) }

            VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 6) {
                if message.role == .assistant {
                    assistantRows
                }

                messageContent

                goalBadge

                deliveryStatus

                if sendState == nil {
                    messageFooter
                }
            }

            if message.role == .assistant { Spacer(minLength: 40) }
        }
    }

    // MARK: - Assistant Rows

    /// Every assistant message renders through the timeline rows, legacy
    /// messages included; only the last row of a streaming turn is live.
    @ViewBuilder
    private var assistantRows: some View {
        let rows = buildTimelineRows(message: message, streaming: isStreaming)
        ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
            Group {
                switch row {
                case .text(let id, let text):
                    textRow(id: id, text: text)
                case .run(let id, let steps):
                    ActionRun(rowId: id, steps: steps, streaming: isStreaming && index == rows.count - 1)
                case .step(_, let step):
                    StepRow(step: standaloneStep(step))
                }
            }
            .environment(\.timelineDisclosureKey, "\(message.sessionId):\(message.id)")
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private func textRow(id: String, text: String) -> some View {
        let highlight = textHighlight(rowId: id)
        if isStreaming {
            StreamingMarkdownView(text: text, baseSize: markdownBaseSize)
        } else if highlight == nil, markdownNeedsRichRenderer(text) {
            // MarkdownUI cannot paint arbitrary ranges; while this text has
            // find matches it falls back to the selectable renderer so
            // highlights stay visible.
            Markdown(text)
                .markdownTextStyle { FontSize(markdownBaseSize) }
                .markdownTheme(.whisperChat)
                .textSelection(.enabled)
        } else {
            SelectableMarkdownText(markdown: text, findHighlight: highlight)
        }
    }

    /// Legacy messages are one text row, so the whole-message highlight applies;
    /// timeline messages slice it per entry (row ids are `text:<entry id>`).
    private func textHighlight(rowId: String) -> MessageFindHighlight? {
        guard let timeline = message.timeline, !timeline.isEmpty else { return findHighlight }
        let entryId = rowId.hasPrefix("text:") ? String(rowId.dropFirst("text:".count)) : rowId
        return message.timelineHighlight(for: entryId, highlight: findHighlight)
    }

    /// Question and plan lines reflect the pending tool input; a plan whose
    /// markdown resolves opens it as its detail.
    private func standaloneStep(_ step: TimelineStep) -> TimelineStep {
        var presented = presentStandaloneStep(
            step,
            isInteractive: pendingToolUseIds.contains(step.id),
            dismissed: dismissedToolCallIds.contains(step.id)
        )
        if presented.kind == .plan, let plan = planContent(in: message.toolCalls ?? [], planToolId: step.id) {
            presented.source = .text(plan, markdown: true)
        }
        return presented
    }

    // MARK: - Delivery Status

    @ViewBuilder
    private var deliveryStatus: some View {
        switch sendState {
        case .sending:
            Text("Sending…")
                .font(.caption2)
                .foregroundStyle(WhisperColor.textMuted)
        case .failed:
            HStack(spacing: 12) {
                Text("Not delivered")
                    .foregroundStyle(WhisperColor.danger)
                if let onRetrySend {
                    Button(action: onRetrySend) {
                        Label("Retry", systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(WhisperColor.danger)
                }
                if let onDiscardSend {
                    Button(action: onDiscardSend) {
                        Image(systemName: "xmark")
                            .foregroundStyle(WhisperColor.textMuted)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Discard message")
                }
            }
            .font(.caption2.weight(.semibold))
        case nil:
            EmptyView()
        }
    }

    // MARK: - Message Content

    private static let thumbSize = CGSize(width: 80, height: 60)
    private static let thumbRadius: CGFloat = 10

    /// User attachments and bubble, or the cancelled notice of an assistant turn;
    /// assistant prose lives in the rows.
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
        } else if message.role == .user, !message.content.isEmpty {
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
        if !isStreaming && message.id != "streaming" {
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
                    .accessibilityLabel(copied ? "Copied" : "Copy message")
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

        if let findHighlight {
            FindHighlighting.apply(to: &result, highlight: findHighlight)
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

// MARK: - Whisper Chat Markdown Theme

/// Caps a table cell's width so prose cells wrap at a readable measure.
/// `frame(maxWidth:)` cannot do this here: it only clamps the size it reports
/// and never proposes the cap to its child, so the table grid measures row
/// heights as if every cell were a single line and wrapped cells overlap the
/// rows below. A Layout proposes the cap during measurement, so the reported
/// height is the wrapped height.
private struct TableCellWidthCap: Layout {
    let maxWidth: CGFloat

    private func childProposal(_ proposal: ProposedViewSize) -> ProposedViewSize {
        ProposedViewSize(width: min(proposal.width ?? maxWidth, maxWidth), height: proposal.height)
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        subviews[0].sizeThatFits(childProposal(proposal))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews[0].place(at: bounds.origin, anchor: .topLeading, proposal: childProposal(proposal))
    }
}

private let whisperLinkColor = Color.accentColor

extension Theme {
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
        // ── Tables ──
        // The stock table style squeezes columns into the bubble width, which
        // collapses wide tables to one character per line. Let the grid take
        // its natural width inside a horizontal scroll instead.
        .table { configuration in
            ScrollView(.horizontal) {
                configuration.label
                    .fixedSize(horizontal: true, vertical: true)
                    .markdownTableBorderStyle(.init(color: WhisperColor.border))
                    .markdownTableBackgroundStyle(
                        .alternatingRows(Color.clear, WhisperColor.codeBlockBg)
                    )
            }
            .markdownMargin(top: .em(0.4), bottom: .em(0.4))
        }
        .tableCell { configuration in
            TableCellWidthCap(maxWidth: 260) {
                configuration.label
                    .markdownTextStyle {
                        if configuration.row == 0 {
                            FontWeight(.semibold)
                        }
                        BackgroundColor(nil)
                        FontSize(.em(12.0 / 14))
                    }
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.vertical, 6)
            .padding(.horizontal, 10)
            .relativeLineSpacing(.em(0.25))
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
                toolCalls: nil,
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
                reasoningSegments: [ReasoningSegment(
                    id: "r1",
                    headline: "Locating the login bug",
                    body: "The user wants me to fix a login bug. Let me look at the auth module."
                )],
                timestamp: "2026-02-17T12:00:05.000Z", cancelled: nil, durationMs: 3200
            ))
            MessageBubble(message: ChatMessage(
                id: "3", sessionId: "s1", role: .assistant,
                content: """
                Findings summary:

                | # | Finding | Category | Tag | Impact | Effort | Risk | Evidence |
                | --- | --- | --- | --- | --- | --- | --- | --- |
                | 1 | `tickets.md` sits untracked at repo root and leaks planning context into every session | housekeeping | intro | Low | Low | None | `tickets.md` at repo root |
                | 2 | Retained error ref in session store keys on workspace+session so a blocking error can bleed | correctness | store | High | Medium | Low | `useSessionStore.ts` |
                """,
                images: nil, toolCalls: nil,
                timestamp: "2026-02-17T12:00:30.000Z", cancelled: nil, durationMs: nil
            ))
            MessageBubble(message: ChatMessage(
                id: "4", sessionId: "s1", role: .assistant,
                content: "This was cancelled midway.",
                images: nil, toolCalls: nil,
                timestamp: "2026-02-17T12:01:00.000Z", cancelled: true, durationMs: 1500
            ))
        }
        .padding()
    }
    .preferredColorScheme(.dark)
}
