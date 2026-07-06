import Foundation
import Testing
@testable import HiveMobileStoresCore

@Suite("Markdown render segments")
struct MarkdownRenderSegmentTests {
    private func rendered(_ markdown: String) -> String {
        (markdownRenderSegments(markdown) ?? []).map(\.text).joined()
    }

    @Test("Flat ordered list injects prefixes and a single separator")
    func orderedListAssembly() {
        #expect(rendered("1. one\n2. two") == "1. one\n2. two")
    }

    @Test("Nested unordered under ordered injects distinct prefixes")
    func nestedAssembly() {
        let out = rendered("1. First\n   - alpha\n   - beta\n2. Second")
        #expect(out == "1. First\n- alpha\n- beta\n2. Second")
    }

    @Test("A link run carries its URL on a content segment only")
    func linkSegment() {
        let segments = markdownRenderSegments("see [docs](https://example.com)") ?? []
        let linked = segments.filter { $0.linkURL != nil }
        #expect(linked.allSatisfy { $0.kind == .content })
        #expect(linked.contains { $0.text.contains("docs") })
    }

    @Test("Separator and prefix segments never carry a link")
    func syntheticSegmentsArePlain() {
        let segments = markdownRenderSegments("1. [a](https://x.com)\n2. b") ?? []
        for seg in segments where seg.kind != .content {
            #expect(seg.linkURL == nil)
        }
    }

    @Test("Code fence produces code-block content segments")
    func codeBlockSegments() {
        let segments = markdownRenderSegments("```\nlet x = 1\n```") ?? []
        #expect(segments.contains { $0.kind == .content && $0.block.isCodeBlock })
    }
}

@Suite("Rich renderer capability check")
struct MarkdownRichCapabilityTests {
    @Test("Plain prose does not need the rich renderer")
    func prose() {
        #expect(markdownNeedsRichRenderer("Just some **bold** text with `inline`.") == false)
    }

    @Test("A code fence stays in the selectable renderer")
    func codeFenceStays() {
        #expect(markdownNeedsRichRenderer("```swift\nlet x = 1\n```") == false)
    }

    @Test("A GFM table needs the rich renderer")
    func table() {
        #expect(markdownNeedsRichRenderer("| a | b |\n| --- | --- |\n| 1 | 2 |") == true)
    }

    @Test("A task list needs the rich renderer")
    func taskList() {
        #expect(markdownNeedsRichRenderer("- [ ] todo\n- [x] done") == true)
    }

    @Test("An image needs the rich renderer")
    func image() {
        #expect(markdownNeedsRichRenderer("![alt](https://x.com/i.png)") == true)
    }

    @Test("A thematic break needs the rich renderer")
    func thematicBreak() {
        #expect(markdownNeedsRichRenderer("Above\n\n---\n\nBelow") == true)
    }

    @Test("A single hyphen bullet is not a thematic break")
    func hyphenBulletNotRule() {
        #expect(markdownNeedsRichRenderer("- one\n- two") == false)
    }

    @Test("A --- separator inside a fenced code block stays selectable")
    func yamlSeparatorInFenceStays() {
        let markdown = "Here is config:\n\n```yaml\nfoo: 1\n---\nbar: 2\n```"
        #expect(markdownNeedsRichRenderer(markdown) == false)
    }

    @Test("A ![] idiom inside a fenced code block stays selectable")
    func bangBracketInFenceStays() {
        #expect(markdownNeedsRichRenderer("```js\nif (![].length) {}\n```") == false)
    }

    @Test("A table-like row inside a fenced code block stays selectable")
    func pipeRowInFenceStays() {
        #expect(markdownNeedsRichRenderer("```\n| - |\n```") == false)
    }

    @Test("A tilde-fenced code block is also excluded")
    func tildeFenceStays() {
        #expect(markdownNeedsRichRenderer("~~~\n---\n~~~") == false)
    }

    @Test("A real table after a code block is still detected")
    func tableAfterFenceDetected() {
        #expect(markdownNeedsRichRenderer("```\ncode\n```\n\n| a | b |\n| --- | --- |") == true)
    }
}
