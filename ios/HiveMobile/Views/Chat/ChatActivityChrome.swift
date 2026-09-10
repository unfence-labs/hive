import SwiftUI

/// Collapse/expand toggles in the transcript must never animate: an animated
/// row-height change makes the List re-align its scroll position, which
/// glitches on tall content. All disclosure toggles go through this.
func withoutAnimation(_ body: () -> Void) {
    var transaction = Transaction()
    transaction.disablesAnimations = true
    withTransaction(transaction, body)
}

/// Port of the web `useCoalescedValue`: `shown` follows `value` but never changes
/// more than once per `window`. A change outside the window shows immediately;
/// changes inside it are held until the window ends, then the latest value shows.
private struct CoalescedValueModifier: ViewModifier {
    let value: String
    let window: TimeInterval
    @Binding var shown: String
    @State private var acceptedAt = Date.distantPast

    func body(content: Content) -> some View {
        content.task(id: value) {
            guard value != shown else { return }
            let elapsed = Date().timeIntervalSince(acceptedAt)
            if elapsed < window {
                try? await Task.sleep(for: .seconds(window - elapsed))
                if Task.isCancelled { return }
            }
            acceptedAt = Date()
            shown = value
        }
    }
}

extension View {
    func coalesced(_ value: String, window: TimeInterval, into shown: Binding<String>) -> some View {
        modifier(CoalescedValueModifier(value: value, window: window, shown: shown))
    }
}

struct ChatActivityBadge: View {
    let text: String

    var body: some View {
        Text(text)
            .font(WhisperFont.mono(10))
            .foregroundStyle(WhisperColor.textMuted)
            .lineLimit(1)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(WhisperColor.toolIconBg, in: Capsule())
    }
}

struct ToolContentPanel<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        content
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(WhisperColor.surface, in: RoundedRectangle(cornerRadius: 8))
            .padding(.top, 2)
    }
}

private struct TimelineExpansionKey: EnvironmentKey {
    static let defaultValue: ConversationTimelineExpansion? = nil
}

private struct TimelineDisclosureKey: EnvironmentKey {
    static let defaultValue: String? = nil
}

extension EnvironmentValues {
    var timelineExpansion: ConversationTimelineExpansion? {
        get { self[TimelineExpansionKey.self] }
        set { self[TimelineExpansionKey.self] = newValue }
    }

    var timelineDisclosureKey: String? {
        get { self[TimelineDisclosureKey.self] }
        set { self[TimelineDisclosureKey.self] = newValue }
    }
}

/// Legacy rows keep local state; timeline rows use their stable event identity.
struct TimelineDisclosureState: DynamicProperty {
    @Environment(\.timelineExpansion) private var expansion
    @Environment(\.timelineDisclosureKey) private var key
    @State private var locallyExpanded = false

    func isExpanded(_ suffix: String) -> Bool {
        guard let expansion, let key else { return locallyExpanded }
        return expansion.contains("\(key):\(suffix)")
    }

    func toggle(_ suffix: String) {
        if let expansion, let key {
            expansion.toggle("\(key):\(suffix)")
        } else {
            locallyExpanded.toggle()
        }
    }
}
