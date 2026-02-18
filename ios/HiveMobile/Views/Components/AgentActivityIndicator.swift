import SwiftUI

/// 3x3 animated dot grid indicating agent activity (streaming/thinking).
/// SwiftUI equivalent of the frontend's AgentActivityPreview.
struct AgentActivityIndicator: View {
    var dotSize: CGFloat = 3
    var spacing: CGFloat = 1.5

    @State private var phase: Double = 0

    var body: some View {
        TimelineView(.animation) { timeline in
            let t = timeline.date.timeIntervalSinceReferenceDate
            Canvas { context, _ in
                for row in 0..<3 {
                    for col in 0..<3 {
                        let angle = atan2(Double(row - 1), Double(col - 1))
                        let normalizedPhase = (angle / (.pi * 2) + 1).truncatingRemainder(dividingBy: 1)
                        let wave = ((t * 0.9 + normalizedPhase).truncatingRemainder(dividingBy: 1) + 1).truncatingRemainder(dividingBy: 1)
                        let raw = (cos((wave - 0.5) * .pi * 2) + 1) / 2
                        let val = max(0, (raw - 0.2) / 0.8)

                        let x = CGFloat(col) * (dotSize + spacing)
                        let y = CGFloat(row) * (dotSize + spacing)
                        let scale = 0.88 + val * 0.12
                        let rect = CGRect(
                            x: x + dotSize * (1 - scale) / 2,
                            y: y + dotSize * (1 - scale) / 2,
                            width: dotSize * scale,
                            height: dotSize * scale
                        )
                        let path = Path(roundedRect: rect, cornerRadius: 1)
                        context.fill(path, with: .color(.white.opacity(val)))
                    }
                }
            }
            .frame(
                width: dotSize * 3 + spacing * 2,
                height: dotSize * 3 + spacing * 2
            )
            .shadow(color: .white.opacity(0.25), radius: dotSize * 2)
        }
    }
}

#Preview {
    VStack(spacing: 20) {
        AgentActivityIndicator()
        AgentActivityIndicator(dotSize: 4, spacing: 2)
    }
    .padding()
    .preferredColorScheme(.dark)
}
