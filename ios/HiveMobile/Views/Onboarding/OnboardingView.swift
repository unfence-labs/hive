import SwiftUI
import UIKit

/// First-run experience: an animated splash that hands off seamlessly from the
/// static launch screen, a typewriter welcome line, then the connect screen.
/// The launch mark stays intact and parks itself as the welcome title; the
/// typewriter cursor pops out of the mark's orange dash as a duplicate.
struct OnboardingView: View {
    let onConnect: (ServerConnection) async -> Bool
    let onComplete: () -> Void

    private enum IntroPhase {
        case splash     // static launch screen replica
        case arriving   // the mark glides into its title slot
        case typing     // tagline types itself
        case settled    // everything visible, CTA shown
    }

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Scales the tagline (and everything derived from its line height, the
    /// cursor metrics and the flight target) with Dynamic Type.
    @ScaledMetric(relativeTo: .title3) private var taglineFontSize: CGFloat = 19
    @State private var phase: IntroPhase = .splash
    @State private var markLanded = false
    @State private var dashSwollen = false
    @State private var cursorFlown = false
    @State private var taglineFrame: CGRect = .zero
    @State private var markSlotFrame: CGRect = .zero
    @State private var showConnect = false

    private static let tagline = "Your coding agents, running on your own server, now in your pocket."
    /// Geometry of the full logo (H plus dash), measured from the 276pt launch
    /// mark asset. `markCenterOffset` is relative to the mark box center, so
    /// the native recreation overlays the static launch image seamlessly.
    private static let markBounds = CGSize(width: 115, height: 176.5)
    private static let markCenterOffset = CGSize(width: -0.25, height: 5.25)
    private static let markHHeight: CGFloat = 159
    private static let dashCenterInMark = CGPoint(x: 57.25, y: 169.5)
    private static let dashSize = CGSize(width: 31, height: 13.5)
    /// H height once the logo is parked as the welcome title.
    private static let parkedHHeight: CGFloat = 44
    private static var parkedScale: CGFloat { parkedHHeight / markHHeight }

    var body: some View {
        NavigationStack {
            ZStack {
                welcome
                if showConnect {
                    ConnectServerView(onConnect: onConnect, onComplete: onComplete)
                        .transition(.move(edge: .trailing))
                        .zIndex(1)
                }
            }
        }
    }

    private var welcome: some View {
        GeometryReader { geo in
            ZStack {
                welcomeContent(in: geo)
                splashBackground
                markView(in: geo)
                duplicateCursor
            }
            .coordinateSpace(.named("welcome"))
            .contentShape(Rectangle())
            .onTapGesture { skipIntro() }
        }
        .hiveScreenBackground()
        .safeAreaInset(edge: .bottom) { getStartedButton }
        .toolbar(.hidden, for: .navigationBar)
        .task { await runIntro() }
    }

    private func welcomeContent(in geo: GeometryProxy) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            // The logo parks here as the title; this reserves its slot.
            Color.clear
                .frame(
                    width: Self.markBounds.width * Self.parkedScale,
                    height: Self.markBounds.height * Self.parkedScale
                )
                .onGeometryChange(for: CGRect.self) { proxy in
                    proxy.frame(in: .named("welcome"))
                } action: { frame in
                    markSlotFrame = frame
                }
            TypewriterText(text: Self.tagline, mode: typewriterMode) {
                settle()
            }
            .font(.system(size: taglineFontSize))
            .foregroundStyle(WhisperColor.textSecondary)
            .lineSpacing(4)
            .onGeometryChange(for: CGRect.self) { proxy in
                proxy.frame(in: .named("welcome"))
            } action: { frame in
                taglineFrame = frame
            }
            .padding(.trailing, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(.horizontal, 28)
        .padding(.top, geo.size.height * 0.32)
    }

    private var typewriterMode: TypewriterText.Mode {
        switch phase {
        case .splash, .arriving: .hidden
        case .typing: .typing
        case .settled: .full
        }
    }

    /// Replica of the static `UILaunchScreen` background; the mark itself is
    /// the native recreation below, so the handoff is invisible.
    private var splashBackground: some View {
        Color("HiveLaunchBackground")
            .ignoresSafeArea()
            .opacity(phase == .splash ? 1 : 0)
            .allowsHitTesting(false)
    }

    /// The intact logo (H plus dash), gliding from the splash center into its
    /// title slot where it stays for good.
    private func markView(in geo: GeometryProxy) -> some View {
        let parked = phase != .splash
        return HiveMarkView(dashScale: dashSwollen ? 1.35 : 1)
            .scaleEffect(parked ? Self.parkedScale : 1)
            .position(
                parked
                    ? CGPoint(x: markSlotFrame.midX, y: markSlotFrame.midY)
                    : splashMarkCenter(in: geo)
            )
            .allowsHitTesting(false)
    }

    /// The typewriter cursor, born as a duplicate of the parked logo's dash:
    /// it pops out with a spring and lands at the tagline origin. It renders
    /// only between the mark landing and the typewriter taking over, and
    /// starts exactly under the logo's own dash so the split reads as a
    /// duplication, not a swap.
    @ViewBuilder
    private var duplicateCursor: some View {
        if markLanded && phase == .arriving {
            let restSize = OnboardingStyle.cursorSize(forLineHeight: taglineLineHeight)
            let size = cursorFlown ? restSize : Self.dashSize.scaled(by: Self.parkedScale)
            RoundedRectangle(
                cornerRadius: cursorFlown
                    ? OnboardingStyle.cursorCornerRadius(forHeight: restSize.height)
                    : size.height / 2,
                style: .continuous
            )
            .fill(OnboardingStyle.brandOrange)
            .frame(width: size.width, height: size.height)
            // The duplicate leaves at the dash's own size and grows en route:
            // size morphs on a gentle curve while the position rides the
            // bouncy spring, so it never balloons at the moment of ejection.
            .animation(.easeInOut(duration: 0.42).delay(0.08), value: cursorFlown)
            .position(cursorFlown ? cursorRestPosition : parkedDashCenter)
            .animation(.spring(duration: 0.5, bounce: 0.3), value: cursorFlown)
            .allowsHitTesting(false)
        }
    }

    /// The mark is centered on the full screen (the launch image ignores safe
    /// areas), so translate that into this safe-area-bound coordinate space.
    private func splashMarkCenter(in geo: GeometryProxy) -> CGPoint {
        let insets = geo.safeAreaInsets
        return CGPoint(
            x: geo.size.width / 2 + Self.markCenterOffset.width,
            y: geo.size.height / 2 + (insets.bottom - insets.top) / 2 + Self.markCenterOffset.height
        )
    }

    /// Where the logo's own dash sits once the mark is parked.
    private var parkedDashCenter: CGPoint {
        CGPoint(
            x: markSlotFrame.minX + Self.dashCenterInMark.x * Self.parkedScale,
            y: markSlotFrame.minY + Self.dashCenterInMark.y * Self.parkedScale
        )
    }

    private var taglineLineHeight: CGFloat {
        UIFont.systemFont(ofSize: taglineFontSize).lineHeight
    }

    /// Where the typewriter cursor rests before the first character: the
    /// leading edge of the tagline's first line.
    private var cursorRestPosition: CGPoint {
        let cursorWidth = OnboardingStyle.cursorSize(forLineHeight: taglineLineHeight).width
        return CGPoint(
            x: taglineFrame.minX + 3 + cursorWidth / 2,
            y: taglineFrame.minY + taglineLineHeight / 2
        )
    }

    private var getStartedButton: some View {
        Button {
            if reduceMotion {
                showConnect = true
            } else {
                withAnimation(.snappy(duration: 0.4)) { showConnect = true }
            }
        } label: {
            Text("Get started").onboardingCTA()
        }
        .buttonStyle(.plain)
        .opacity(phase == .settled ? 1 : 0)
        .offset(y: phase == .settled ? 0 : 10)
        .allowsHitTesting(phase == .settled)
        .accessibilityHidden(phase != .settled)
        .padding(.horizontal, 20)
        .padding(.bottom, 14)
    }

    /// `Task.sleep` throws when the hosting task is cancelled (the view was
    /// removed, e.g. by the locked-launch activation path): bail out through
    /// the catch instead of bursting through the remaining steps and firing
    /// haptics on a screen that is gone. The phase guards handle the other
    /// early exit, a tap-to-skip changing state while this task sleeps.
    private func runIntro() async {
        guard phase == .splash else { return }
        do {
            if reduceMotion {
                try await Task.sleep(for: .milliseconds(600))
                guard phase == .splash else { return }
                markLanded = true
                cursorFlown = true
                phase = .settled
                Haptics.impact(.light)
                return
            }
            try await Task.sleep(for: .milliseconds(900))
            guard phase == .splash else { return }
            withAnimation(.easeInOut(duration: 0.65)) { phase = .arriving }
            try await Task.sleep(for: .milliseconds(650))
            guard phase == .arriving else { return }
            markLanded = true
            Haptics.impact(.light)
            try await Task.sleep(for: .milliseconds(100))
            guard phase == .arriving else { return }
            // The dash inflates...
            withAnimation(.easeOut(duration: 0.12)) { dashSwollen = true }
            try await Task.sleep(for: .milliseconds(110))
            guard phase == .arriving else { return }
            // ...expels the duplicate at peak swell, then recoils with a wobble.
            // The duplicate's own `.animation(value:)` modifiers drive its flight.
            cursorFlown = true
            withAnimation(.spring(duration: 0.35, bounce: 0.45)) { dashSwollen = false }
            Haptics.selection()  // the cursor announces itself
            try await Task.sleep(for: .milliseconds(590))
            guard phase == .arriving else { return }
            phase = .typing
        } catch {}
    }

    /// A tap anywhere completes the intro instantly.
    private func skipIntro() {
        guard phase != .settled else { return }
        withAnimation(.easeOut(duration: 0.25)) {
            markLanded = true
            dashSwollen = false
            cursorFlown = true
            phase = .settled
        }
    }

    private func settle() {
        withAnimation(.easeOut(duration: 0.35)) { phase = .settled }
    }
}

private extension CGSize {
    func scaled(by factor: CGFloat) -> CGSize {
        CGSize(width: width * factor, height: height * factor)
    }
}

/// Native recreation of the full launch mark (H plus orange dash), measured
/// from the source asset so it overlays the static launch image seamlessly.
/// Intrinsic size matches `OnboardingView.markBounds`. `dashScale` inflates
/// the dash in place for the cursor-expulsion beat.
private struct HiveMarkView: View {
    var dashScale: CGFloat = 1

    var body: some View {
        ZStack(alignment: .topLeading) {
            Group {
                Capsule(style: .circular)
                    .frame(width: 35.5, height: 159)
                Capsule(style: .circular)
                    .frame(width: 35.5, height: 159)
                    .offset(x: 79.5)
                Rectangle()
                    .frame(width: 59.5, height: 30)
                    .offset(x: 27.75, y: 65.5)
            }
            .foregroundStyle(OnboardingStyle.markInk)
            Capsule(style: .circular)
                .frame(width: 31, height: 13.5)
                .scaleEffect(dashScale)
                .offset(x: 42, y: 163)
                .foregroundStyle(OnboardingStyle.brandOrange)
        }
        .frame(width: 115, height: 176.5, alignment: .topLeading)
    }
}

#Preview {
    OnboardingView(onConnect: { _ in true }, onComplete: {})
        .preferredColorScheme(.dark)
}
