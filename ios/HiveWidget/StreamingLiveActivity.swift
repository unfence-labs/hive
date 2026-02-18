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
                        VStack(alignment: .leading, spacing: 2) {
                            ForEach(context.state.workspaces, id: \.self) { ws in
                                workspaceLabelView(ws, font: .caption)
                            }
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
                compactTrailingView(context.state)
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
                if let ws = context.state.workspaces.first {
                    workspaceLabelView(ws, font: .caption)
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

    // MARK: - Workspace Label (bold project · light branch)

    private func workspaceLabelView(_ ws: WorkspaceLabel, font: Font) -> Text {
        Text(ws.project).font(font.weight(.semibold)) +
        Text(" · ").font(font).foregroundColor(.secondary) +
        Text(ws.branch).font(font).foregroundColor(.secondary)
    }

    // MARK: - Helpers

    private func headerText(_ state: StreamingAttributes.ContentState) -> String {
        state.activeCount == 1 ? "Hive agent working" : "\(state.activeCount) Hive agents working"
    }

    @ViewBuilder
    private func compactTrailingView(_ state: StreamingAttributes.ContentState) -> some View {
        if state.activeCount == 1, let ws = state.workspaces.first {
            (Text(ws.project).fontWeight(.semibold) + Text(" · \(ws.branch)"))
                .font(.caption.monospacedDigit())
                .lineLimit(1)
        } else {
            Text("\(state.activeCount) active")
                .font(.caption.monospacedDigit())
        }
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
