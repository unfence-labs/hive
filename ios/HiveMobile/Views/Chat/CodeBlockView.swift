import SwiftUI
import UIKit

/// Presentation only: MarkdownUI supplies the code; the caller owns stream completion.
///
/// Chrome mirrors the web renderer: a tinted header carrying the lowercase
/// language and the block actions, a hairline, then the code on the card fill.
struct CodeBlockView: View {
    let code: String
    let language: String?
    var isComplete = true

    @ScaledMetric(relativeTo: .body) private var fontSize: CGFloat = 12
    @State private var copied = false

    private static let cornerRadius: CGFloat = 10

    /// Actions stay mounted while a fence is open so the header never reflows.
    private var actionsEnabled: Bool { isComplete && !code.isEmpty }

    private var languageLabel: String {
        guard let language, !language.trimmingCharacters(in: .whitespaces).isEmpty else { return "code" }
        return language.trimmingCharacters(in: .whitespaces).lowercased()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider().overlay(WhisperColor.separator)
            codeBody
        }
        .background(WhisperColor.codeBlockBg)
        .clipShape(RoundedRectangle(cornerRadius: Self.cornerRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Self.cornerRadius, style: .continuous)
                .strokeBorder(WhisperColor.border, lineWidth: 1)
        )
        .task(id: copied) {
            guard copied else { return }
            do {
                try await Task.sleep(for: .seconds(2))
                withAnimation(.snappy(duration: 0.2)) { copied = false }
            } catch {}
        }
        .onChange(of: code) { copied = false }
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 0) {
            Text(languageLabel)
                .font(WhisperFont.mono(10))
                .foregroundStyle(WhisperColor.textMuted)
                .lineLimit(1)
                .padding(.leading, 12)

            Spacer(minLength: 8)

            Button {
                UIPasteboard.general.string = code
                withAnimation(.snappy(duration: 0.2)) { copied = true }
            } label: {
                actionIcon(
                    copied ? "checkmark" : "doc.on.doc",
                    tint: copied ? WhisperColor.success : WhisperColor.textSecondary
                )
            }
            .accessibilityLabel(copied ? "Copied" : "Copy code")

            ShareLink(item: code) {
                actionIcon("square.and.arrow.up", tint: WhisperColor.textSecondary)
            }
            .accessibilityLabel("Share code")
        }
        .buttonStyle(.plain)
        .disabled(!actionsEnabled)
        .background(WhisperColor.codeBg)
    }

    /// Matches the message footer's hit area (44 x 38) so the header stays
    /// compact while every action clears the touch-target minimum.
    private func actionIcon(_ systemName: String, tint: Color) -> some View {
        Image(systemName: systemName)
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(tint)
            .contentTransition(.symbolEffect(.replace))
            .frame(width: 16, height: 16)
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .contentShape(Rectangle())
            .opacity(actionsEnabled ? 1 : 0.4)
            .animation(.easeOut(duration: 0.2), value: actionsEnabled)
    }

    // MARK: - Code

    private var codeBody: some View {
        ScrollView(.horizontal) {
            SelectableCodeText(code: code, fontSize: fontSize)
                .fixedSize(horizontal: true, vertical: false)
        }
        .scrollIndicators(.hidden)
        .scrollBounceBehavior(.basedOnSize)
        // Full-bleed scrolling: the code slides to the card edge instead of
        // vanishing into a padded gutter, but rests inset like the header.
        .contentMargins(.horizontal, 12, for: .scrollContent)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A read-only native text view keeps partial selection and copies whitespace verbatim.
private struct SelectableCodeText: UIViewRepresentable {
    let code: String
    let fontSize: CGFloat

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.isEditable = false
        view.isSelectable = true
        view.isScrollEnabled = false
        view.backgroundColor = .clear
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        if view.text != code {
            let selection = view.selectedRange
            view.text = code
            if NSMaxRange(selection) <= (code as NSString).length {
                view.selectedRange = selection
            }
        }
        view.font = .monospacedSystemFont(ofSize: fontSize, weight: .regular)
        view.textColor = UIColor(WhisperColor.codeText)
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        let font = UIFont.monospacedSystemFont(ofSize: fontSize, weight: .regular)
        let longestLine = code.split(separator: "\n", omittingEmptySubsequences: false)
            .map { (String($0) as NSString).size(withAttributes: [.font: font]).width }
            .max() ?? 0
        let width = max(1, ceil(longestLine) + 1)
        let size = uiView.sizeThatFits(CGSize(width: width, height: CGFloat.greatestFiniteMagnitude))
        return CGSize(width: width, height: ceil(size.height))
    }
}

private struct CompletedCodeBlocksKey: EnvironmentKey {
    /// Nil means a finished response; an empty set means no streamed block has closed yet.
    static let defaultValue: Set<String>? = nil
}

extension EnvironmentValues {
    var completedCodeBlocks: Set<String>? {
        get { self[CompletedCodeBlocksKey.self] }
        set { self[CompletedCodeBlocksKey.self] = newValue }
    }
}

struct MarkdownCodeBlock: View {
    let code: String
    let language: String?
    @Environment(\.completedCodeBlocks) private var completed

    var body: some View {
        CodeBlockView(
            code: code,
            language: language,
            isComplete: completed.map { $0.contains(code.trimmingCharacters(in: .newlines)) } ?? true
        )
    }
}

// MARK: - Preview

private let previewCode = """
func login(using credentials: Credentials) async throws -> Session {
    let token = try await tokenStore.token(for: credentials)
    return try await validate(token)
}
"""

#Preview("Code block") {
    ScrollView {
        VStack(alignment: .leading, spacing: 16) {
            CodeBlockView(code: previewCode, language: "Swift")
            CodeBlockView(code: "npm run test -- --watch", language: "bash")
            CodeBlockView(code: previewCode, language: nil)
            CodeBlockView(code: "let partial = ", language: "swift", isComplete: false)
        }
        .padding()
    }
    .background(WhisperColor.appBackground)
}
