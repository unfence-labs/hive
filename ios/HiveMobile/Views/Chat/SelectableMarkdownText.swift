import SwiftUI
import UIKit

struct SelectableMarkdownText: UIViewRepresentable {
    let markdown: String
    var findHighlight: MessageFindHighlight? = nil

    @Environment(\.colorScheme) private var colorScheme

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator {
        var lastMarkdown: String?
        var lastFindHighlight: MessageFindHighlight?
        var baseRendered: NSAttributedString?
    }

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.isEditable = false
        view.isSelectable = true
        view.isScrollEnabled = false
        view.backgroundColor = .clear
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.linkTextAttributes = [.foregroundColor: UIColor.tintColor]
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.setContentHuggingPriority(.required, for: .vertical)
        return view
    }

    func updateUIView(_ uiView: UITextView, context: Context) {
        uiView.overrideUserInterfaceStyle = colorScheme == .dark ? .dark : .light
        let coordinator = context.coordinator
        guard coordinator.lastMarkdown != markdown || coordinator.lastFindHighlight != findHighlight else {
            return
        }
        if coordinator.lastMarkdown != markdown || coordinator.baseRendered == nil {
            coordinator.baseRendered = renderMarkdown(markdown)
            coordinator.lastMarkdown = markdown
        }
        coordinator.lastFindHighlight = findHighlight
        guard let base = coordinator.baseRendered else { return }
        if let findHighlight {
            let highlighted = NSMutableAttributedString(attributedString: base)
            FindHighlighting.apply(to: highlighted, highlight: findHighlight)
            uiView.attributedText = highlighted
        } else {
            uiView.attributedText = base
        }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        guard let width = proposal.width, width.isFinite, width > 0 else { return nil }
        return uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
    }
}

private func markdownFont(size: CGFloat, weight: UIFont.Weight, italic: Bool, mono: Bool) -> UIFont {
    var font = mono
        ? UIFont.monospacedSystemFont(ofSize: size, weight: weight)
        : UIFont.systemFont(ofSize: size, weight: weight)
    if italic,
       let descriptor = font.fontDescriptor.withSymbolicTraits(
           font.fontDescriptor.symbolicTraits.union(.traitItalic)
       ) {
        font = UIFont(descriptor: descriptor, size: size)
    }
    return font
}

private func paragraphStyle(for block: MarkdownBlockContext) -> NSParagraphStyle {
    let style = NSMutableParagraphStyle()
    style.lineSpacing = 1
    style.paragraphSpacing = 6
    if block.headerLevel != nil {
        style.paragraphSpacingBefore = 6
    }
    if block.indentLevel > 0 {
        let indent = CGFloat(block.indentLevel) * 14
        style.firstLineHeadIndent = indent - 14
        style.headIndent = indent
    }
    if block.isBlockQuote {
        style.firstLineHeadIndent = 12
        style.headIndent = 12
    }
    if block.isCodeBlock {
        style.lineSpacing = 0
        style.paragraphSpacingBefore = 6
        style.paragraphSpacing = 6
        style.firstLineHeadIndent = 6
        style.headIndent = 6
    }
    return style
}

private let headingSizes: [CGFloat] = [20, 17, 15, 14, 13, 12]

private func blockAttributes(
    inline: InlinePresentationIntent?,
    block: MarkdownBlockContext
) -> [NSAttributedString.Key: Any] {
    let inline = inline ?? []
    var size: CGFloat = 14
    var weight: UIFont.Weight = .regular
    var color = UIColor(WhisperColor.text)
    var background: UIColor?
    var mono = false

    if let level = block.headerLevel {
        size = headingSizes[min(max(level, 1), 6) - 1]
        weight = level <= 3 ? .semibold : .medium
        if level >= 5 { color = UIColor(WhisperColor.textSecondary) }
    }
    if block.isBlockQuote {
        color = UIColor(WhisperColor.textSecondary)
    }
    if block.isCodeBlock {
        mono = true
        size = 12
        color = UIColor(WhisperColor.codeText)
        background = UIColor(WhisperColor.codeBlockBg)
    } else if inline.contains(.code) {
        mono = true
        size = 12
        color = UIColor(WhisperColor.codeText)
        background = UIColor(WhisperColor.codeBg)
    }
    if inline.contains(.stronglyEmphasized) {
        weight = .semibold
    }

    var attrs: [NSAttributedString.Key: Any] = [
        .font: markdownFont(size: size, weight: weight, italic: inline.contains(.emphasized), mono: mono),
        .foregroundColor: color,
        .paragraphStyle: paragraphStyle(for: block)
    ]
    if let background {
        attrs[.backgroundColor] = background
    }
    if inline.contains(.strikethrough) {
        attrs[.strikethroughStyle] = NSUnderlineStyle.single.rawValue
    }
    return attrs
}

private func renderMarkdown(_ markdown: String) -> NSAttributedString {
    guard let segments = markdownRenderSegments(markdown) else {
        return NSAttributedString(string: markdown, attributes: [
            .font: UIFont.systemFont(ofSize: 14),
            .foregroundColor: UIColor(WhisperColor.text)
        ])
    }

    let result = NSMutableAttributedString()
    for segment in segments {
        var attrs = blockAttributes(inline: segment.inline, block: segment.block)
        switch segment.kind {
        case .content:
            if let url = segment.linkURL { attrs[.link] = url }
        case .separator, .listPrefix:
            attrs.removeValue(forKey: .backgroundColor)
        }
        result.append(NSAttributedString(string: segment.text, attributes: attrs))
    }
    return result
}
