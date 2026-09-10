import SwiftUI

/// One step line: icon, subject, verb pill, stats or output summary, and a
/// failure or severity mark. Shared by step rows and the live run header.
/// `live` forces the shimmer: the run header stays alive between tools while
/// the agent keeps working. Mirrors `StepLineContent` in the web `StepRow.tsx`.
struct StepLineContent: View {
    let step: TimelineStep
    var live = false

    private var running: Bool { step.status == .running }
    private var failed: Bool { step.status == .failed }

    private var outputSummary: String? {
        guard step.status == .completed, step.stats == nil, case .tool(let tool) = step.source else { return nil }
        return getOutputSummary(tool)
    }

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: step.icon)
                .font(.system(size: 9))
                .frame(width: 14, height: 14)
                .foregroundStyle(failed ? WhisperColor.danger : WhisperColor.textMuted)

            if !step.subject.isEmpty {
                Text(step.subject)
                    .font(WhisperFont.mono(12))
                    .foregroundStyle(WhisperColor.textMuted)
                    .lineLimit(1)
                    .stepShimmer(live || running)
            }

            if !step.verb.isEmpty {
                ChatActivityBadge(text: running ? step.liveVerb.lowercased() : step.verb)
                    .fixedSize()
            }

            if let stats = step.stats {
                switch stats.kind {
                case .diff:
                    HStack(spacing: 4) {
                        if stats.added > 0 {
                            Text("+\(stats.added)")
                                .foregroundStyle(WhisperColor.diffAdded)
                        }
                        if stats.removed > 0 {
                            Text("\u{2212}\(stats.removed)")
                                .foregroundStyle(WhisperColor.diffRemoved)
                        }
                    }
                    .font(WhisperFont.mono(10))
                    .fixedSize()
                case .plain:
                    if let label = stats.label {
                        Text(label)
                            .font(WhisperFont.mono(10))
                            .foregroundStyle(WhisperColor.textMuted.opacity(0.7))
                            .lineLimit(1)
                    }
                }
            }

            if let outputSummary {
                Text(outputSummary)
                    .font(WhisperFont.mono(10))
                    .foregroundStyle(WhisperColor.textMuted.opacity(0.7))
                    .lineLimit(1)
            }

            if failed {
                StepMark(icon: "xmark.circle", color: WhisperColor.danger, label: "\(step.subject) failed")
            } else if step.severity == .error {
                StepMark(icon: "xmark.circle", color: WhisperColor.danger, label: "Diagnostic error")
            } else if step.severity == .warning {
                StepMark(icon: "exclamationmark.triangle", color: WhisperColor.warningForeground, label: "Diagnostic warning")
            }
        }
        .padding(.vertical, 3)
        .contentShape(Rectangle())
    }
}

/// Trailing failure or severity mark of a step line.
struct StepMark: View {
    let icon: String
    let color: Color
    let label: String

    var body: some View {
        Image(systemName: icon)
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(color)
            .frame(width: 14, height: 14)
            .accessibilityLabel(label)
    }
}

/// A step line that opens its single detail panel; lines without a detail are
/// plain. Expansion lives in the timeline expansion store under `step:<id>`.
struct StepRow: View {
    let step: TimelineStep
    private var disclosure = TimelineDisclosureState()

    init(step: TimelineStep) {
        self.step = step
    }

    private var suffix: String { "step:\(step.id)" }
    private var isExpanded: Bool { disclosure.isExpanded(suffix) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if hasStepDetail(step) {
                Button {
                    withoutAnimation { disclosure.toggle(suffix) }
                } label: {
                    StepLineContent(step: step)
                }
                .buttonStyle(.plain)
                .accessibilityValue(isExpanded ? "expanded" : "collapsed")

                if isExpanded {
                    ToolContentPanel {
                        StepDetail(step: step)
                    }
                }
            } else {
                StepLineContent(step: step)
            }
        }
    }
}

/// Agents recurse with their children; every other step is a plain row.
struct StepItem: View {
    let step: TimelineStep
    let streaming: Bool

    var body: some View {
        if step.kind == .agent {
            AgentStep(step: step, streaming: streaming)
        } else {
            StepRow(step: step)
        }
    }
}
