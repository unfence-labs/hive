import SwiftUI
import UIKit

struct SelectableDiffText: UIViewRepresentable {
    let lines: [DiffLine]
    let onTapLine: (DiffLine) -> Void
    let onCommentSelection: (DiffLine, String) -> Void

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.isEditable = false
        view.isSelectable = true
        view.isScrollEnabled = false
        view.backgroundColor = .clear
        view.textContainerInset = UIEdgeInsets(top: 2, left: 8, bottom: 2, right: 8)
        view.textContainer.lineFragmentPadding = 0
        view.delegate = context.coordinator
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleTap(_:)))
        tap.cancelsTouchesInView = false
        tap.delegate = context.coordinator
        view.addGestureRecognizer(tap)
        return view
    }

    func updateUIView(_ uiView: UITextView, context: Context) {
        context.coordinator.parent = self
        if context.coordinator.renderedLines != lines {
            let (text, ranges) = Self.render(lines)
            uiView.attributedText = text
            context.coordinator.lineRanges = ranges
            context.coordinator.renderedLines = lines
        }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        guard let width = proposal.width, width > 0 else { return nil }
        let size = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        return CGSize(width: width, height: size.height)
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    private static func render(_ lines: [DiffLine]) -> (NSAttributedString, [(NSRange, DiffLine)]) {
        let font = UIFont.monospacedSystemFont(ofSize: 12, weight: .regular)
        let result = NSMutableAttributedString()
        var ranges: [(NSRange, DiffLine)] = []
        for line in lines {
            let content = "\(line.prefix) \(line.text)\n"
            let start = result.length
            result.append(NSAttributedString(string: content, attributes: [
                .font: font,
                .foregroundColor: textColor(line.kind),
                .backgroundColor: backgroundColor(line.kind),
            ]))
            ranges.append((NSRange(location: start, length: content.count), line))
        }
        return (result, ranges)
    }

    private static func textColor(_ kind: DiffLine.Kind) -> UIColor {
        switch kind {
        case .context: UIColor(WhisperColor.textSecondary)
        case .added: .systemGreen
        case .removed: .systemRed
        }
    }

    private static func backgroundColor(_ kind: DiffLine.Kind) -> UIColor {
        switch kind {
        case .context: .clear
        case .added: UIColor.systemGreen.withAlphaComponent(0.12)
        case .removed: UIColor.systemRed.withAlphaComponent(0.12)
        }
    }

    final class Coordinator: NSObject, UITextViewDelegate, UIGestureRecognizerDelegate {
        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
        ) -> Bool {
            true
        }

        var parent: SelectableDiffText
        var lineRanges: [(NSRange, DiffLine)] = []
        var renderedLines: [DiffLine]?

        init(parent: SelectableDiffText) {
            self.parent = parent
        }

        func textView(
            _ textView: UITextView,
            editMenuForTextIn range: NSRange,
            suggestedActions: [UIMenuElement]
        ) -> UIMenu? {
            guard range.length > 0,
                  let line = lineRanges.first(where: { NSIntersectionRange($0.0, range).length > 0 })?.1,
                  let textRange = Range(range, in: textView.text)
            else { return UIMenu(children: suggestedActions) }
            let snippet = String(textView.text[textRange])
            let comment = UIAction(title: "Add comment", image: UIImage(systemName: "text.bubble")) { [weak self] _ in
                textView.selectedTextRange = nil
                self?.parent.onCommentSelection(line, snippet)
            }
            return UIMenu(children: [comment] + suggestedActions)
        }

        @objc func handleTap(_ gesture: UITapGestureRecognizer) {
            guard let textView = gesture.view as? UITextView,
                  textView.selectedRange.length == 0 else { return }
            var point = gesture.location(in: textView)
            point.x -= textView.textContainerInset.left
            point.y -= textView.textContainerInset.top
            let index = textView.layoutManager.characterIndex(
                for: point,
                in: textView.textContainer,
                fractionOfDistanceBetweenInsertionPoints: nil
            )
            guard let line = lineRanges.first(where: { NSLocationInRange(index, $0.0) })?.1 else { return }
            parent.onTapLine(line)
        }
    }
}
