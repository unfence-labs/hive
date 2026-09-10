import SwiftUI

private let liveLabelWindow: TimeInterval = 0.2

/// A sub-agent step: type, description, the deepest running child's live label,
/// the child count and a failure mark. Opens to the Prompt line, the children
/// (indented, no rail) and the Result line. Expansion lives in the timeline
/// expansion store under `agent:<id>`. Mirrors `AgentStep.tsx`.
struct AgentStep: View {
    let step: TimelineStep
    let streaming: Bool
    private var disclosure = TimelineDisclosureState()
    @State private var shownLive = ""

    init(step: TimelineStep, streaming: Bool) {
        self.step = step
        self.streaming = streaming
    }

    private var suffix: String { "agent:\(step.id)" }
    private var open: Bool { disclosure.isExpanded(suffix) }
    private var running: Bool { step.status == .running }
    private var failed: Bool { step.status == .failed }
    private var finished: Bool { step.status == .completed || failed }

    private var tool: ToolCall? {
        if case .tool(let tool) = step.source { return tool }
        return nil
    }

    private var liveText: String {
        guard running, let live = findLiveDescendant(step.children) else { return "" }
        return liveLabel(for: live)
    }

    var body: some View {
        if let tool, let info = parseSubAgentInfo(tool) {
            VStack(alignment: .leading, spacing: 0) {
                Button {
                    withoutAnimation { disclosure.toggle(suffix) }
                } label: {
                    line(info)
                }
                .buttonStyle(.plain)
                .accessibilityValue(open ? "expanded" : "collapsed")

                if open {
                    VStack(alignment: .leading, spacing: 2) {
                        if let prompt = info.prompt, !prompt.isEmpty {
                            StepRow(step: textStep(id: "\(step.id):prompt", kind: .prompt, subject: "Prompt", text: prompt))
                        }
                        ForEach(step.children) { child in
                            StepItem(step: child, streaming: streaming)
                        }
                        if finished, let output = tool.output, !output.isEmpty {
                            StepRow(step: textStep(
                                id: "\(step.id):result",
                                kind: .result,
                                subject: failed ? "Failure" : "Result",
                                text: output
                            ))
                        }
                    }
                    .padding(.leading, 16)
                }
            }
            .coalesced(liveText, window: liveLabelWindow, into: $shownLive)
        } else {
            StepRow(step: step)
        }
    }

    private func line(_ info: SubAgentInfo) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "arrow.triangle.branch")
                .font(.system(size: 9))
                .frame(width: 14, height: 14)
                .foregroundStyle(failed ? WhisperColor.danger : WhisperColor.textMuted)

            Text(info.subagentType)
                .font(WhisperFont.mono(12))
                .foregroundStyle(WhisperColor.textMuted)
                .fixedSize()

            if !info.description.isEmpty {
                Text(info.description)
                    .font(WhisperFont.scaled(12))
                    .foregroundStyle(WhisperColor.textMuted)
                    .lineLimit(1)
            }

            if !shownLive.isEmpty {
                separator
                Text(shownLive)
                    .font(WhisperFont.mono(12))
                    .foregroundStyle(WhisperColor.textMuted)
                    .lineLimit(1)
                    .stepShimmer()
            }

            if !step.children.isEmpty {
                separator
                Text("\(step.children.count) tool\(step.children.count == 1 ? "" : "s")")
                    .font(WhisperFont.mono(10))
                    .foregroundStyle(WhisperColor.textMuted.opacity(0.6))
                    .fixedSize()
            }

            if failed {
                StepMark(icon: "xmark.circle", color: WhisperColor.danger, label: "\(step.subject) failed")
            }
        }
        .padding(.vertical, 3)
        .contentShape(Rectangle())
    }

    private var separator: some View {
        Text("·")
            .font(WhisperFont.mono(12))
            .foregroundStyle(WhisperColor.textMuted)
    }
}

/// Deepest running step, so a nested agent's live tool bubbles up to the top line.
private func findLiveDescendant(_ steps: [TimelineStep]) -> TimelineStep? {
    guard let live = findLiveStep(in: steps) else { return nil }
    if live.children.isEmpty { return live }
    return findLiveDescendant(live.children) ?? live
}

/// Synthetic Prompt / Result lines; never part of the view-model rows or run counts.
private func textStep(id: String, kind: TimelineStepKind, subject: String, text: String) -> TimelineStep {
    let markdown = kind == .result ? parseContentBlocks(text) : nil
    return TimelineStep(
        id: id,
        kind: kind,
        icon: kind == .prompt ? "text.bubble" : "arrow.turn.down.right",
        liveVerb: "",
        verb: "",
        subject: subject,
        status: .completed,
        standalone: true,
        source: .text(markdown ?? text, markdown: markdown != nil)
    )
}
