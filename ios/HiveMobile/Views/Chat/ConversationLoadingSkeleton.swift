import SwiftUI

struct ConversationLoadingSkeleton: View {
    private struct Placeholder: Identifiable {
        let id = UUID()
        let fraction: CGFloat
        let height: CGFloat
        let trailing: Bool
    }

    private let placeholders: [Placeholder] = [
        Placeholder(fraction: 0.52, height: 40, trailing: true),
        Placeholder(fraction: 0.86, height: 104, trailing: false),
        Placeholder(fraction: 0.38, height: 30, trailing: true),
        Placeholder(fraction: 0.72, height: 72, trailing: false),
        Placeholder(fraction: 0.6, height: 52, trailing: false)
    ]

    var body: some View {
        GeometryReader { geometry in
            VStack(spacing: HiveSpacing.lg) {
                ForEach(placeholders) { placeholder in
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(WhisperColor.surfaceSubtle)
                        .frame(width: geometry.size.width * placeholder.fraction, height: placeholder.height)
                        .frame(maxWidth: .infinity, alignment: placeholder.trailing ? .trailing : .leading)
                        .shimmer()
                }
                Spacer(minLength: 0)
            }
            .padding(.top, HiveSpacing.lg)
        }
        .padding(.horizontal, HiveSpacing.lg)
    }
}

#Preview {
    ConversationLoadingSkeleton()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .hiveScreenBackground()
        .preferredColorScheme(.dark)
}
