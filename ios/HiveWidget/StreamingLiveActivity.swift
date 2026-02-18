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
                    Image(systemName: "brain")
                        .font(.title3)
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
                        .contentTransition(.numericText())
                }
            } compactLeading: {
                HStack(spacing: 2) {
                    Image(systemName: "brain")
                        .font(.system(size: 12))
                    Text("\(context.state.activeCount)")
                        .font(.system(size: 14, weight: .bold).monospacedDigit())
                        .contentTransition(.numericText())
                }
            } compactTrailing: {
                EmptyView()
            } minimal: {
                Image(systemName: "brain")
                    .font(.system(size: 12))
            }
        }
    }

    // MARK: - Lock Screen

    @ViewBuilder
    private func lockScreenView(context: ActivityViewContext<StreamingAttributes>) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "brain")
                .font(.title3)

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
                .contentTransition(.numericText())
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

}
