import Foundation
import Testing
@testable import HiveMobileStoresCore

@Suite("Markdown block structure")
struct MarkdownStructureTests {
    private func context(in markdown: String, forText text: String) -> MarkdownBlockContext? {
        guard let parsed = try? AttributedString(
            markdown: markdown,
            options: .init(interpretedSyntax: .full, failurePolicy: .returnPartiallyParsedIfPossible)
        ) else {
            return nil
        }
        for run in parsed.runs {
            if String(parsed[run.range].characters).contains(text) {
                return markdownBlockContext(run.presentationIntent)
            }
        }
        return nil
    }

    @Test("Nested unordered list under an ordered list keeps distinct prefixes")
    func nestedUnorderedUnderOrdered() {
        let markdown = "1. First\n   - alpha\n   - beta\n2. Second"

        let first = context(in: markdown, forText: "First")
        let alpha = context(in: markdown, forText: "alpha")
        let beta = context(in: markdown, forText: "beta")
        let second = context(in: markdown, forText: "Second")

        #expect(first?.listPrefix == "1. ")
        #expect(alpha?.listItemID != nil)
        #expect(beta?.listItemID != nil)
        #expect(alpha?.listItemID != first?.listItemID)
        #expect(beta?.listItemID != first?.listItemID)
        #expect(alpha?.listItemID != beta?.listItemID)
        #expect(alpha?.isOrdered == false)
        #expect(beta?.isOrdered == false)
        #expect(alpha?.listPrefix == "- ")
        #expect(beta?.listPrefix == "- ")
        #expect(second?.listPrefix == "2. ")
    }

    @Test("Nested ordered list under an unordered list keeps ordinals")
    func nestedOrderedUnderUnordered() {
        let markdown = "- Top\n  1. one\n  2. two\n- Next"

        let top = context(in: markdown, forText: "Top")
        let one = context(in: markdown, forText: "one")
        let two = context(in: markdown, forText: "two")
        let next = context(in: markdown, forText: "Next")

        #expect(top?.listPrefix == "- ")
        #expect(one?.isOrdered == true)
        #expect(two?.isOrdered == true)
        #expect(one?.listPrefix == "1. ")
        #expect(two?.listPrefix == "2. ")
        #expect(next?.listPrefix == "- ")
    }

    @Test("Flat ordered list keeps correct prefixes and distinct identities")
    func flatOrderedList() {
        let markdown = "1. one\n2. two"

        let one = context(in: markdown, forText: "one")
        let two = context(in: markdown, forText: "two")

        #expect(one?.listPrefix == "1. ")
        #expect(two?.listPrefix == "2. ")
        #expect(one?.listItemID != two?.listItemID)
    }

    @Test("Flat unordered list keeps correct prefixes and distinct identities")
    func flatUnorderedList() {
        let markdown = "- x\n- y"

        let x = context(in: markdown, forText: "x")
        let y = context(in: markdown, forText: "y")

        #expect(x?.listPrefix == "- ")
        #expect(y?.listPrefix == "- ")
        #expect(x?.listItemID != y?.listItemID)
    }

    @Test("Non-list paragraph has no list state")
    func nonListParagraph() {
        let context = context(in: "plain", forText: "plain")

        #expect(context?.listItemID == nil)
        #expect(context?.listPrefix == nil)
        #expect(context?.indentLevel == 0)
    }
}
