import SwiftUI

struct BrainSessionEmptyState: View {
    var body: some View {
        VStack(spacing: HiveSpacing.lg) {
            Image(systemName: "brain")
                .font(.system(size: 28, weight: .medium))
                .foregroundStyle(Color.accentColor)
                .frame(width: 48, height: 48)
                .background(WhisperColor.surfaceSubtle, in: Circle())

            VStack(spacing: HiveSpacing.sm) {
                Text("Start a Brain conversation")
                    .font(.headline)
                    .foregroundStyle(WhisperColor.text)

                Text("Ask Hive to capture, organize, or retrieve notes from your Brain.")
                    .font(.subheadline)
                    .foregroundStyle(WhisperColor.textSecondary)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: 340)
        .padding(.horizontal, HiveSpacing.lg)
    }
}

#Preview {
    BrainSessionEmptyState()
        .padding()
        .preferredColorScheme(.dark)
}
