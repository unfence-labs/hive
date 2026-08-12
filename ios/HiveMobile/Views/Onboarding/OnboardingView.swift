import SwiftUI
import UIKit

/// First-run experience: an animated splash that hands off seamlessly from the
/// static launch screen, a typewriter welcome line, then the connect screen.
/// The launch mark's orange dash detaches during the splash and flies down to
/// become the typewriter cursor.
struct OnboardingView: View {
    let onConnect: (ServerConnection) async -> Bool
    let onComplete: () -> Void

    private enum IntroPhase {
        case splash     // static launch screen replica
        case arriving   // splash lifts away, dash flies to the text origin
        case typing     // tagline types itself
        case settled    // everything visible, CTA shown
    }

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase: IntroPhase = .splash
    @State private var titleShown = false
    @State private var taglineFrame: CGRect = .zero
    @State private var showConnect = false

    private static let tagline = "Your coding agents, running on your own server, now in your pocket."
    private static let taglineFontSize: CGFloat = 19
    /// Center offset of the orange dash inside the 276pt launch mark, measured
    /// from the source asset, plus its size. Keeps the flying capsule flush
    /// over the mark's own dash before it takes off.
    private static let markDashOffset = CGSize(width: 0, height: 86.5)
    private static let markDashSize = CGSize(width: 31, height: 13.5)

    var body: some View {
        NavigationStack {
            welcome
                .navigationDestination(isPresented: $showConnect) {
                    ConnectServerView(onConnect: onConnect, onComplete: onComplete)
                }
        }
    }

    private var welcome: some View {
        GeometryReader { geo in
            ZStack {
                welcomeContent(in: geo)
                splashOverlay
                flyingDash(in: geo)
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
            Text("Hive")
                .font(.system(size: 46, weight: .heavy))
                .tracking(-1)
                .foregroundStyle(WhisperColor.text)
                .opacity(titleShown ? 1 : 0)
                .offset(y: titleShown ? 0 : 14)
            TypewriterText(text: Self.tagline, mode: typewriterMode) {
                settle()
            }
            .font(.system(size: Self.taglineFontSize))
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

    /// Replica of the static `UILaunchScreen` so the handoff is invisible.
    private var splashOverlay: some View {
        ZStack {
            Color("HiveLaunchBackground")
            Image("HiveLaunchMark")
                .scaleEffect(phase == .splash ? 1 : 0.9)
                .offset(y: phase == .splash ? 0 : -14)
        }
        .ignoresSafeArea()
        .opacity(phase == .splash ? 1 : 0)
        .allowsHitTesting(false)
    }

    /// The orange dash: sits exactly over the mark's dash during the splash,
    /// then flies to the tagline origin and morphs into the cursor shape. The
    /// typewriter's own cursor takes over once typing starts.
    private func flyingDash(in geo: GeometryProxy) -> some View {
        let flown = phase != .splash
        let size = flown ? OnboardingStyle.cursorSize : Self.markDashSize
        return RoundedRectangle(
            cornerRadius: flown ? OnboardingStyle.cursorCornerRadius : Self.markDashSize.height / 2,
            style: .continuous
        )
        .fill(OnboardingStyle.brandOrange)
        .frame(width: size.width, height: size.height)
        .position(flown ? cursorRestPosition : markDashPosition(in: geo))
        .opacity(phase == .splash || phase == .arriving ? 1 : 0)
        .allowsHitTesting(false)
    }

    /// The mark is centered on the full screen (the launch image ignores safe
    /// areas), so translate that into this safe-area-bound coordinate space.
    private func markDashPosition(in geo: GeometryProxy) -> CGPoint {
        let insets = geo.safeAreaInsets
        let screenCenter = CGPoint(
            x: geo.size.width / 2,
            y: geo.size.height / 2 + (insets.bottom - insets.top) / 2
        )
        return CGPoint(
            x: screenCenter.x + Self.markDashOffset.width,
            y: screenCenter.y + Self.markDashOffset.height
        )
    }

    /// Where the typewriter cursor rests before the first character: the
    /// leading edge of the tagline's first line.
    private var cursorRestPosition: CGPoint {
        let lineHeight = UIFont.systemFont(ofSize: Self.taglineFontSize).lineHeight
        return CGPoint(
            x: taglineFrame.minX + 3 + OnboardingStyle.cursorSize.width / 2,
            y: taglineFrame.minY + lineHeight / 2
        )
    }

    private var getStartedButton: some View {
        Button {
            showConnect = true
        } label: {
            Text("Get started").onboardingCTA()
        }
        .buttonStyle(.plain)
        .opacity(phase == .settled ? 1 : 0)
        .offset(y: phase == .settled ? 0 : 10)
        .allowsHitTesting(phase == .settled)
        .padding(.horizontal, 20)
        .padding(.bottom, 14)
    }

    private func runIntro() async {
        guard phase == .splash else { return }
        if reduceMotion {
            try? await Task.sleep(for: .milliseconds(600))
            guard phase == .splash else { return }
            titleShown = true
            phase = .settled
            Haptics.impact(.light)
            return
        }
        try? await Task.sleep(for: .milliseconds(900))
        guard phase == .splash else { return }
        withAnimation(.easeInOut(duration: 0.65)) { phase = .arriving }
        try? await Task.sleep(for: .milliseconds(350))
        guard phase == .arriving else { return }
        withAnimation(.easeOut(duration: 0.5)) { titleShown = true }
        Haptics.impact(.light)
        try? await Task.sleep(for: .milliseconds(750))
        guard phase == .arriving else { return }
        phase = .typing
    }

    /// A tap anywhere completes the intro instantly.
    private func skipIntro() {
        guard phase != .settled else { return }
        withAnimation(.easeOut(duration: 0.25)) {
            titleShown = true
            phase = .settled
        }
    }

    private func settle() {
        withAnimation(.easeOut(duration: 0.35)) { phase = .settled }
    }
}

#Preview {
    OnboardingView(onConnect: { _ in true }, onComplete: {})
        .preferredColorScheme(.dark)
}
