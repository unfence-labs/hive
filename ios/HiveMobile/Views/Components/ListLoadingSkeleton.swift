import SwiftUI

/// Placeholder rows shaped like list rows (leading avatar + two text lines),
/// animated with the theme shimmer. Used for empty initial loads of the Hub,
/// Brain, and workspace conversation lists. Reduce Motion is handled by
/// `shimmer()`.
struct ListLoadingSkeleton: View {
    var rowCount = 6

    private let titleWidths: [CGFloat] = [220, 150, 240, 130, 190, 170]

    var body: some View {
        VStack(spacing: HiveSpacing.md) {
            ForEach(0..<rowCount, id: \.self) { index in
                HStack(spacing: HiveSpacing.md) {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(WhisperColor.surfaceSubtle)
                        .frame(width: 40, height: 40)
                    VStack(alignment: .leading, spacing: 7) {
                        RoundedRectangle(cornerRadius: 5, style: .continuous)
                            .fill(WhisperColor.surfaceSubtle)
                            .frame(width: titleWidths[index % titleWidths.count], height: 14)
                        RoundedRectangle(cornerRadius: 5, style: .continuous)
                            .fill(WhisperColor.surfaceSubtle)
                            .frame(width: 100, height: 11)
                    }
                    Spacer(minLength: 0)
                }
                .shimmer()
            }
            Spacer(minLength: 0)
        }
        .padding(HiveSpacing.lg)
        .accessibilityHidden(true)
    }
}

#Preview {
    ListLoadingSkeleton()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .hiveScreenBackground()
}
