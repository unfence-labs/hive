import UIKit

/// The app's entire haptic vocabulary. Kept deliberately small so the sparse
/// mapping (send/stop, plan and question outcomes, composer toggles) can be
/// read in one place. `UIFeedbackGenerator` automatically respects the system
/// haptics setting, so there is no in-app toggle.
@MainActor
enum Haptics {
    static func impact(_ style: UIImpactFeedbackGenerator.FeedbackStyle) {
        UIImpactFeedbackGenerator(style: style).impactOccurred()
    }

    static func notify(_ type: UINotificationFeedbackGenerator.FeedbackType) {
        UINotificationFeedbackGenerator().notificationOccurred(type)
    }

    static func selection() {
        UISelectionFeedbackGenerator().selectionChanged()
    }
}
