import ActivityKit
import SwiftUI
import WidgetKit

struct StreamingLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: StreamingAttributes.self) { context in
            lockScreenView(context: context)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HiveDotGrid(dotSize: 4, spacing: 2)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(headerText(context.state))
                            .font(.headline)
                            .lineLimit(1)
                        if !context.state.workspaceLabels.isEmpty {
                            Text(context.state.workspaceLabels.joined(separator: "\n"))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(3)
                        }
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text("\(context.state.activeCount)")
                        .font(.title2.monospacedDigit())
                }
            } compactLeading: {
                HStack(spacing: 4) {
                    HiveDotGrid(dotSize: 3, spacing: 1.5)
                    Image(systemName: "circle.fill")
                        .font(.system(size: 4))
                        .foregroundStyle(.white.opacity(0.6))
                        .symbolEffect(.breathe)
                }
            } compactTrailing: {
                Text(compactTrailingText(context.state))
                    .font(.caption.monospacedDigit())
            } minimal: {
                Image(systemName: "circle.fill")
                    .font(.system(size: 6))
                    .symbolEffect(.breathe)
            }
        }
    }

    // MARK: - Lock Screen

    @ViewBuilder
    private func lockScreenView(context: ActivityViewContext<StreamingAttributes>) -> some View {
        HStack(spacing: 12) {
            HiveDotGrid(dotSize: 4, spacing: 2)

            VStack(alignment: .leading, spacing: 2) {
                Text(headerText(context.state))
                    .font(.subheadline.weight(.semibold))
                if !context.state.workspaceLabels.isEmpty {
                    Text(context.state.workspaceLabels.joined(separator: ", "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            Spacer()

            Text("\(context.state.activeCount)")
                .font(.title2.monospacedDigit().weight(.bold))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    // MARK: - Helpers

    private func headerText(_ state: StreamingAttributes.ContentState) -> String {
        state.activeCount == 1 ? "Workspace working" : "\(state.activeCount) workspaces working"
    }

    private func compactTrailingText(_ state: StreamingAttributes.ContentState) -> String {
        if state.activeCount == 1, let label = state.workspaceLabels.first {
            return label
        }
        return "\(state.activeCount) active"
    }
}

// MARK: - Static 3x3 Dot Grid (widget-compatible)

private struct HiveDotGrid: View {
    var dotSize: CGFloat = 3
    var spacing: CGFloat = 1.5

    private static let opacities: [[Double]] = [
        [0.3, 0.7, 0.4],
        [0.8, 1.0, 0.6],
        [0.5, 0.9, 0.3],
    ]

    var body: some View {
        VStack(spacing: spacing) {
            ForEach(0..<3, id: \.self) { row in
                HStack(spacing: spacing) {
                    ForEach(0..<3, id: \.self) { col in
                        RoundedRectangle(cornerRadius: dotSize * 0.3)
                            .fill(Color.white.opacity(Self.opacities[row][col]))
                            .frame(width: dotSize, height: dotSize)
                    }
                }
            }
        }
        .shadow(color: .white.opacity(0.2), radius: dotSize)
    }
}
