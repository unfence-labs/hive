import SwiftUI
import UIKit

/// Types its text one character at a time with a per-letter haptic tick and a
/// trailing block cursor. The cursor is drawn by a `TextRenderer` so it tracks
/// the last glyph across wrapped lines; it stays steady while typing and
/// blinks once the text has settled.
struct TypewriterText: View {
    enum Mode: Equatable {
        /// Nothing shown yet (the flying dash owns the cursor spot).
        case hidden
        /// Animate the text in, character by character.
        case typing
        /// Show the full text immediately (skip or Reduce Motion).
        case full
    }

    let text: String
    let mode: Mode
    var onFinished: () -> Void = {}

    @State private var typedCount = 0
    @State private var typingTask: Task<Void, Never>?
    @State private var settledAt: Date?

    private static let charDelayMs = 35.0
    private static let jitterMs = 15.0
    private static let commaPauseMs = 140.0
    private static let blinkInterval = 0.53

    private var displayed: String {
        switch mode {
        case .hidden: ""
        case .typing: String(text.prefix(typedCount))
        case .full: text
        }
    }

    private var isSettled: Bool {
        mode == .full || (mode == .typing && typedCount >= text.count)
    }

    var body: some View {
        TimelineView(.periodic(from: .now, by: isSettled ? Self.blinkInterval : 3600)) { context in
            Text(displayed)
                .textRenderer(TrailingCursorRenderer(cursorOpacity: cursorOpacity(at: context.date)))
        }
        .onAppear { if mode == .typing { startTyping() } }
        .onChange(of: mode) { _, newMode in
            if newMode == .typing { startTyping() } else { typingTask?.cancel() }
        }
        .onChange(of: isSettled) { _, settled in
            settledAt = settled ? Date() : nil
        }
        .onDisappear { typingTask?.cancel() }
    }

    /// Steady while typing; blinks once settled, starting from a visible beat
    /// so the cursor never vanishes the instant the last character lands.
    private func cursorOpacity(at date: Date) -> Double {
        if mode == .hidden { return 0 }
        guard isSettled else { return 1 }
        let reference = settledAt ?? date
        let beat = Int(max(0, date.timeIntervalSince(reference)) / Self.blinkInterval)
        return beat.isMultiple(of: 2) ? 1 : 0
    }

    private func startTyping() {
        typingTask?.cancel()
        typedCount = 0
        typingTask = Task { @MainActor in
            let ticker = UISelectionFeedbackGenerator()
            ticker.prepare()
            let characters = Array(text)
            for index in characters.indices {
                guard !Task.isCancelled else { return }
                typedCount = index + 1
                let character = characters[index]
                // Silence on whitespace accents the word rhythm.
                if !character.isWhitespace {
                    ticker.selectionChanged()
                    ticker.prepare()
                }
                var delay = Self.charDelayMs + Double.random(in: -Self.jitterMs...Self.jitterMs)
                if character == "," { delay += Self.commaPauseMs }
                try? await Task.sleep(for: .milliseconds(delay))
            }
            guard !Task.isCancelled else { return }
            onFinished()
        }
    }
}

/// Draws the text normally, then a rounded block cursor after the last glyph.
private struct TrailingCursorRenderer: TextRenderer {
    var cursorOpacity: Double

    /// Room for the cursor past the last glyph so it never gets clipped when
    /// the last line is the widest one.
    var displayPadding: EdgeInsets {
        EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: OnboardingStyle.cursorSize.width + 3)
    }

    func draw(layout: Text.Layout, in context: inout GraphicsContext) {
        for line in layout {
            context.draw(line)
        }
        guard cursorOpacity > 0, let lastLine = layout.last else { return }
        let bounds = lastLine.typographicBounds.rect
        let size = OnboardingStyle.cursorSize
        let rect = CGRect(
            x: bounds.maxX + 3,
            y: bounds.midY - size.height / 2,
            width: size.width,
            height: size.height
        )
        context.fill(
            Path(roundedRect: rect, cornerRadius: OnboardingStyle.cursorCornerRadius),
            with: .color(OnboardingStyle.brandOrange.opacity(cursorOpacity))
        )
    }
}
