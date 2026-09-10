import SwiftUI
import UIKit

/// Presentation only: MarkdownUI supplies the code; the caller owns stream completion.
struct CodeBlockView: View {
    let code: String
    let language: String?
    var isComplete = true

    @ScaledMetric(relativeTo: .body) private var fontSize: CGFloat = 12
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(language ?? "Code")
                    .font(.caption.monospaced())
                    .lineLimit(1)
                Spacer(minLength: 8)
                Button {
                    UIPasteboard.general.string = code
                    copied = true
                } label: {
                    Image(systemName: copied ? "checkmark" : "doc.on.doc")
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel(copied ? "Copied" : "Copy code")
                ShareLink(item: code) {
                    Image(systemName: "square.and.arrow.up")
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Share code")
            }
            .buttonStyle(.plain)
            .disabled(!isComplete || code.isEmpty)
            .foregroundStyle(WhisperColor.textSecondary)

            ScrollView(.horizontal) {
                SelectableCodeText(code: code, fontSize: fontSize)
                    .fixedSize(horizontal: true, vertical: false)
            }
            .padding(.bottom, 12)
        }
        .padding(.horizontal, 12)
        .background(WhisperColor.codeBlockBg, in: RoundedRectangle(cornerRadius: 8))
        .task(id: copied) {
            guard copied else { return }
            do {
                try await Task.sleep(for: .seconds(2))
                copied = false
            } catch {}
        }
        .onChange(of: code) { copied = false }
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
