import SwiftUI

private let liveStepWindow: TimeInterval = 0.2

/// A run of consecutive steps. While streaming the header is the current step's
/// own line with a shimmer; a finished run of `runCollapseThreshold` or more
/// steps collapses into "N tools used"; fewer steps list flat. Expanded steps sit
/// at the header's level, no rail. Expansion lives in the timeline expansion
/// store under `run:<row id>`. Mirrors `ActionRun.tsx`.
struct ActionRun: View {
    let rowId: String
    let steps: [TimelineStep]
    let streaming: Bool
    private var disclosure = TimelineDisclosureState()
    @State private var shownLiveKey = ""

    init(rowId: String, steps: [TimelineStep], streaming: Bool) {
        self.rowId = rowId
        self.steps = steps
        self.streaming = streaming
    }

    private var suffix: String { "run:\(rowId)" }
    private var open: Bool { disclosure.isExpanded(suffix) }

    private static func stepKey(_ step: TimelineStep) -> String { "\(step.id):\(step.status)" }

    // The live line is the current step's own line; a new tool or a status change swaps it.
    private var labelStep: TimelineStep? { findLiveStep(in: steps) ?? steps.last }
    private var liveKey: String { labelStep.map(Self.stepKey) ?? "" }
    private var liveStep: TimelineStep? { steps.first { Self.stepKey($0) == shownLiveKey } ?? labelStep }

    private var flat: Bool { !streaming && steps.count < runCollapseThreshold }

    /// Running agents stay visible under the collapsed live header; the open list already holds them.
    private var liveAgents: [TimelineStep] {
        streaming && !open ? steps.filter { $0.kind == .agent && $0.status == .running } : []
    }

    private func toggle() {
        withoutAnimation { disclosure.toggle(suffix) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if streaming, let liveStep {
                Button(action: toggle) {
                    StepLineContent(step: liveStep, live: true)
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Current step: \(liveLabel(for: liveStep))")
                .accessibilityValue(open ? "expanded" : "collapsed")
            } else if !flat {
                Button(action: toggle) {
                    RunSummaryLine(summary: summarizeRun(steps))
                }
                .buttonStyle(.plain)
                .accessibilityValue(open ? "expanded" : "collapsed")
            }

            ForEach(liveAgents) { step in
                AgentStep(step: step, streaming: streaming)
            }

            if flat || open {
                ForEach(steps) { step in
                    StepItem(step: step, streaming: streaming)
                }
            }
        }
        .coalesced(streaming ? liveKey : "", window: liveStepWindow, into: $shownLiveKey)
    }
}

/// Finished run header: the distinct step icons, the summary label and a failed count.
private struct RunSummaryLine: View {
    let summary: RunSummary

    var body: some View {
        HStack(spacing: 6) {
            HStack(spacing: 3) {
                ForEach(summary.icons, id: \.self) { icon in
                    Image(systemName: icon)
                        .font(.system(size: 9))
                }
            }
            .foregroundStyle(WhisperColor.textMuted.opacity(0.5))

            Text(summary.label)
                .font(WhisperFont.mono(12))
                .foregroundStyle(WhisperColor.textMuted)
                .lineLimit(1)

            if summary.failed > 0 {
                HStack(spacing: 2) {
                    Image(systemName: "xmark.circle")
                        .font(.system(size: 12, weight: .medium))
                    Text("\(summary.failed)")
                        .font(WhisperFont.mono(10))
                }
                .foregroundStyle(WhisperColor.danger)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(summary.failed) failed")
            }
        }
        .padding(.vertical, 3)
        .contentShape(Rectangle())
    }
}
