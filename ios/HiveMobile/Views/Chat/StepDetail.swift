import MarkdownUI
import SwiftUI

private let outsideWorkspaceMessage = "Image is outside the workspace and cannot be previewed."
private let detailImageSize = CGSize(width: 80, height: 80)

/// False for steps whose line carries everything there is to show. A plan step
/// only opens once MessageBubble resolved its markdown into a `.text` source.
func hasStepDetail(_ step: TimelineStep) -> Bool {
    switch step.source {
    case .reasoning(let segments):
        // The line already shows the latest headline; only open when there is more to read.
        return segments.contains { !($0.body ?? "").isEmpty }
            || segments.filter { !($0.headline ?? "").isEmpty }.count > 1
    case .tool:
        return step.kind != .plan
    case .activity:
        return step.kind != .compaction && step.kind != .subagentActivity
    case .text:
        return true
    }
}

/// Content of the single detail panel under a step line, by source.
/// Mirrors `StepDetail.tsx`; the panel chrome is `ToolContentPanel`.
struct StepDetail: View {
    let step: TimelineStep

    var body: some View {
        switch step.source {
        case .tool(let tool):
            if step.kind == .question {
                QuestionDetail(tool: tool)
            } else {
                ToolDetail(step: step, tool: tool)
            }
        case .reasoning(let segments):
            ReasoningDetail(segments: segments)
        case .activity(let activity):
            ActivityDetail(activity: activity, pending: step.status == .running)
        case .text(let text, let markdown):
            if markdown {
                MarkdownDetail(text: text)
            } else {
                MonoText(text: text)
            }
        }
    }
}

// MARK: - Tool

private struct ToolDetail: View {
    let step: TimelineStep
    let tool: ToolCall

    /// Full path or full command when the line had to shorten it.
    private var fullSubject: String? {
        guard let title = step.subjectTitle, title != step.subject else { return nil }
        return title
    }

    var body: some View {
        let output = tool.output ?? ""
        let showOutput = !output.isEmpty && !toolHidesOutput(tool.name)

        VStack(alignment: .leading, spacing: 8) {
            if tool.name == "Edit" || tool.name == "Write" {
                DiffDetail(tool: tool)
            } else if let fullSubject {
                MonoText(text: fullSubject)
            } else if !showOutput {
                // Last resort so the panel is never empty: the raw input.
                MonoText(text: tool.input)
            }

            if showOutput {
                Text("OUTPUT")
                    .font(WhisperFont.mono(9))
                    .foregroundStyle(WhisperColor.textMuted)
                    .tracking(1)
                if tool.name == "Task", let text = parseContentBlocks(output) {
                    MarkdownDetail(text: text)
                } else {
                    MonoText(text: output)
                }
            }
        }
    }
}

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

/// Edit/Write tool detail: the file path and the diff lines.
private struct DiffDetail: View {
    let tool: ToolCall
    private let parsed: (filePath: String?, lines: [DiffLine])

    init(tool: ToolCall) {
        self.tool = tool
        self.parsed = DiffDetail.buildParsed(tool)
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
        VStack(alignment: .leading, spacing: 0) {
            if let path = parsed.filePath {
                Text(path)
                    .font(WhisperFont.mono(10))
                    .foregroundStyle(WhisperColor.textMuted)
                    .lineLimit(1)
                    .padding(.bottom, 6)
            }

            DiffLinesView(lines: parsed.lines)
        }
    }
}

// MARK: - Question

private struct QuestionsPayload: Decodable {
    let questions: [Question]
}

/// Read-only recap of the questions; answers are collected in the tool input sheet.
private struct QuestionDetail: View {
    let tool: ToolCall

    private var questions: [Question] {
        guard let data = tool.input.data(using: .utf8),
              let payload = try? JSONDecoder().decode(QuestionsPayload.self, from: data) else {
            return []
        }
        return payload.questions
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(questions.enumerated()), id: \.offset) { index, question in
                if index > 0 {
                    Divider().overlay(WhisperColor.separator)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(question.question)
                        .font(WhisperFont.scaled(12, weight: .medium))
                        .foregroundStyle(WhisperColor.textSecondary)
                    ForEach(Array(question.options.enumerated()), id: \.offset) { optionIndex, option in
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text("\(optionIndex + 1).")
                                .foregroundStyle(WhisperColor.textMuted)
                            Text(optionLabel(option))
                                .foregroundStyle(WhisperColor.textMuted)
                        }
                        .font(WhisperFont.mono(11))
                    }
                }
            }
        }
    }

    private func optionLabel(_ option: QuestionOption) -> String {
        guard let description = option.description, !description.isEmpty else { return option.label }
        return "\(option.label) · \(description)"
    }
}

// MARK: - Reasoning

private struct ReasoningDetail: View {
    let segments: [ReasoningSegment]

    private var thoughts: [ReasoningSegment] {
        segments.filter { !($0.headline ?? "").isEmpty || !($0.body ?? "").isEmpty }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            ForEach(thoughts) { thought in
                ReasoningThoughtRow(thought: thought)
            }
        }
    }
}

/// One compact log line: a discreet middot marker, the headline in the primary
/// text color, and the body dimmed. Mirrors the web compact reasoning view.
private struct ReasoningThoughtRow: View {
    let thought: ReasoningSegment

    private var line: Text {
        let headline = Text(thought.headline ?? "").foregroundColor(WhisperColor.text)
        let separator = Text(thought.headline != nil && thought.body != nil ? " · " : "")
            .foregroundColor(WhisperColor.textMuted)
        let body = Text(thought.body ?? "").foregroundColor(WhisperColor.textSecondary)
        return Text("\(headline)\(separator)\(body)")
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("·")
                .foregroundStyle(WhisperColor.textMuted)
            line
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        }
        .font(WhisperFont.mono(11))
        .lineSpacing(2)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Activity

private struct ActivityDetail: View {
    let activity: AgentActivity
    let pending: Bool

    var body: some View {
        switch activity {
        case .diagnostic(let diagnostic):
            VStack(alignment: .leading, spacing: 8) {
                Text(diagnostic.message)
                    .font(WhisperFont.scaled(12))
                    .foregroundStyle(WhisperColor.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)

                if let details = diagnostic.details, !details.isEmpty {
                    Text(details)
                        .font(WhisperFont.mono(10))
                        .foregroundStyle(WhisperColor.textMuted)
                        .textSelection(.enabled)
                        .lineLimit(80)
                }
            }
        case .imageView(let image):
            ChatImageTileWithLightbox(
                source: image.resolvedSource,
                size: detailImageSize,
                noPreviewMessage: image.outsideWorkspace == true ? outsideWorkspaceMessage : nil
            )
        case .imageGeneration(let image):
            VStack(alignment: .leading, spacing: 8) {
                ChatImageTileWithLightbox(
                    source: image.resolvedSource,
                    pending: pending,
                    size: detailImageSize
                )
                if let prompt = image.revisedPrompt, !prompt.isEmpty {
                    Text(prompt)
                        .font(WhisperFont.scaled(12))
                        .foregroundStyle(WhisperColor.textSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        default:
            EmptyView()
        }
    }
}

// MARK: - Text

private struct MarkdownDetail: View {
    let text: String
    @ScaledMetric(relativeTo: .body) private var baseSize: CGFloat = 13

    var body: some View {
        Markdown(text)
            .markdownTextStyle { FontSize(baseSize) }
            .markdownTheme(.whisperChat)
            .frame(maxWidth: .infinity, alignment: .leading)
            .textSelection(.enabled)
    }
}

private struct MonoText: View {
    let text: String

    var body: some View {
        Text(text)
            .font(WhisperFont.mono(11))
            .foregroundStyle(WhisperColor.textSecondary)
            .lineLimit(20)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
