import MarkdownUI
import SwiftUI

struct StreamingMarkdownView: View {
    let text: String
    let baseSize: CGFloat

    var body: some View {
        let parts = splitStableMarkdownPrefix(text)
        VStack(alignment: .leading, spacing: baseSize) {
            if !parts.stable.isEmpty {
                StablePrefixMarkdown(text: parts.stable, baseSize: baseSize)
                    .equatable()
            }
            if !parts.tail.isEmpty {
                Markdown(parts.tail)
                    .markdownTextStyle { FontSize(baseSize) }
                    .markdownTheme(.whisperChat)
            }
        }
    }
}

private struct StablePrefixMarkdown: View, Equatable {
    let text: String
    let baseSize: CGFloat

    var body: some View {
        Markdown(text)
            .markdownTextStyle { FontSize(baseSize) }
            .markdownTheme(.whisperChat)
    }
}
