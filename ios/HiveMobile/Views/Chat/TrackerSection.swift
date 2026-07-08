import SwiftUI

/// A collapsible tracker section: a header row (chevron + label + optional
/// trailing meta) that expands to reveal its rows. Shared by the goal, tasks,
/// and background-agent sections of `TaskTrackerView` to avoid duplication —
/// mirrors the identical section structure in `frontend/src/components/TaskTracker.tsx`.
struct TrackerSection<Rows: View>: View {
    let label: String
    let trailing: String?
    let isShimmering: Bool
    @ViewBuilder let rows: () -> Rows

    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withoutAnimation { isExpanded.toggle() }
            } label: {
                collapsedRow
            }
            .buttonStyle(.plain)

            if isExpanded {
                VStack(alignment: .leading, spacing: 2) {
                    rows()
                }
                .padding(.top, 6)
                .padding(.bottom, 2)
            }
        }
    }

    private var collapsedRow: some View {
        HStack(spacing: HiveSpacing.sm) {
            Image(systemName: "chevron.right")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(WhisperColor.textMuted)
                .rotationEffect(.degrees(isExpanded ? 90 : 0))
                .frame(width: 14, alignment: .center)

            Group {
                if isShimmering {
                    Text(label).shimmer()
                } else {
                    Text(label)
                }
            }
            .font(WhisperFont.mono(12))
            .foregroundStyle(WhisperColor.textSecondary)
            .lineLimit(1)
            .truncationMode(.tail)
            .frame(maxWidth: .infinity, alignment: .leading)

            if let trailing {
                Text(trailing)
                    .font(WhisperFont.mono(11))
                    .foregroundStyle(WhisperColor.textMuted)
            }
        }
        .contentShape(Rectangle())
        .padding(.vertical, 2)
    }
}
