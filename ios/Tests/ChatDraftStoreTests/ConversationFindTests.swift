import XCTest
@testable import HiveMobileStoresCore

final class ConversationFindTests: XCTestCase {
    private func messages(_ contents: [String]) -> [FindableMessage] {
        contents.enumerated().map {
            FindableMessage(id: "m\($0.offset)", content: $0.element, rendersMarkdown: false)
        }
    }

    // MARK: - Matching

    func testMatchRangesFindsAllOccurrencesLeftToRight() {
        let ranges = ConversationFindModel.matchRanges(in: "abc abc abc", query: "abc")
        XCTAssertEqual(ranges, [0..<3, 4..<7, 8..<11])
    }

    func testMatchRangesIsCaseInsensitive() {
        let ranges = ConversationFindModel.matchRanges(in: "Hello HELLO hello", query: "hello")
        XCTAssertEqual(ranges.count, 3)
    }

    func testMatchRangesIsDiacriticInsensitive() {
        XCTAssertEqual(ConversationFindModel.matchRanges(in: "café", query: "cafe"), [0..<4])
        XCTAssertEqual(ConversationFindModel.matchRanges(in: "cafe", query: "café"), [0..<4])
    }

    func testMatchRangesDoesNotOverlap() {
        XCTAssertEqual(ConversationFindModel.matchRanges(in: "aaaa", query: "aa"), [0..<2, 2..<4])
    }

    func testMatchRangesEmptyQueryReturnsNothing() {
        XCTAssertTrue(ConversationFindModel.matchRanges(in: "anything", query: "").isEmpty)
    }

    func testMatchRangesUsesUTF16Offsets() {
        // The emoji is 2 UTF-16 code units, so "fix" starts at offset 3.
        let ranges = ConversationFindModel.matchRanges(in: "🚀 fix", query: "fix")
        XCTAssertEqual(ranges, [3..<6])
    }

    // MARK: - Update / ordering

    func testUpdateOrdersMatchesByMessageThenPosition() {
        var model = ConversationFindModel()
        model.update(messages: messages(["b then b", "nothing", "b"]), query: "b")
        XCTAssertEqual(model.matches.map(\.messageId), ["m0", "m0", "m2"])
        XCTAssertEqual(model.matches.map(\.range), [0..<1, 7..<8, 0..<1])
        // A fresh query activates the newest (bottom-most) match, shown as "1 of N".
        XCTAssertEqual(model.activeIndex, 2)
        XCTAssertEqual(model.displayIndex, 1)
    }

    func testUpdateWithNoMatchesClearsActiveIndex() {
        var model = ConversationFindModel()
        model.update(messages: messages(["hello"]), query: "zzz")
        XCTAssertEqual(model.matchCount, 0)
        XCTAssertEqual(model.activeIndex, -1)
        XCTAssertNil(model.activeMatch)
    }

    func testQueryChangeResetsActiveToNewestMatch() {
        var model = ConversationFindModel()
        model.update(messages: messages(["a a a"]), query: "a")
        model.previous()
        XCTAssertEqual(model.activeIndex, 1)
        model.update(messages: messages(["a a a"]), query: "a ")
        XCTAssertEqual(model.activeIndex, 1)
        XCTAssertEqual(model.matchCount, 2)
        XCTAssertEqual(model.displayIndex, 1)
    }

    func testContentChangeKeepsActivePositionAndClamps() {
        var model = ConversationFindModel()
        model.update(messages: messages(["a a a"]), query: "a")
        model.previous()
        XCTAssertEqual(model.activeIndex, 1)
        // Same query, more content: position kept.
        model.update(messages: messages(["a a a", "a"]), query: "a")
        XCTAssertEqual(model.activeIndex, 1)
        // Same query, less content: clamped to the last match.
        model.update(messages: messages(["a"]), query: "a")
        XCTAssertEqual(model.activeIndex, 0)
    }

    // MARK: - Navigation

    func testNextAndPreviousWrapAround() {
        var model = ConversationFindModel()
        model.update(messages: messages(["x x x"]), query: "x")
        XCTAssertEqual(model.activeIndex, 2)
        model.previous()
        model.previous()
        XCTAssertEqual(model.activeIndex, 0)
        model.previous()
        XCTAssertEqual(model.activeIndex, 2)
        model.next()
        XCTAssertEqual(model.activeIndex, 0)
    }

    func testNavigationWithNoMatchesStaysInactive() {
        var model = ConversationFindModel()
        model.update(messages: messages(["hello"]), query: "nope")
        model.next()
        XCTAssertEqual(model.activeIndex, -1)
        model.previous()
        XCTAssertEqual(model.activeIndex, -1)
    }

    // MARK: - Per-message highlight payload

    func testHighlightIsNilForUnmatchedMessages() {
        var model = ConversationFindModel()
        model.update(messages: messages(["match here", "nothing"]), query: "match")
        XCTAssertNotNil(model.highlight(for: "m0"))
        XCTAssertNil(model.highlight(for: "m1"))
    }

    func testHighlightCarriesActiveOrdinalWithinMessage() {
        var model = ConversationFindModel()
        model.update(messages: messages(["a a", "a a"]), query: "a")
        // Fresh query: active is the newest global match = second occurrence in m1.
        XCTAssertEqual(model.highlight(for: "m1"),
                       MessageFindHighlight(ranges: [0..<1, 2..<3], activeOrdinal: 1))
        XCTAssertEqual(model.highlight(for: "m0"),
                       MessageFindHighlight(ranges: [0..<1, 2..<3], activeOrdinal: nil))
        model.previous()
        XCTAssertEqual(model.highlight(for: "m1"),
                       MessageFindHighlight(ranges: [0..<1, 2..<3], activeOrdinal: 0))
        model.previous()
        XCTAssertEqual(model.highlight(for: "m1"),
                       MessageFindHighlight(ranges: [0..<1, 2..<3], activeOrdinal: nil))
        XCTAssertEqual(model.highlight(for: "m0"),
                       MessageFindHighlight(ranges: [0..<1, 2..<3], activeOrdinal: 1))
    }

    func testResetClearsEverything() {
        var model = ConversationFindModel()
        model.update(messages: messages(["a"]), query: "a")
        model.reset()
        XCTAssertEqual(model.query, "")
        XCTAssertEqual(model.matchCount, 0)
        XCTAssertEqual(model.activeIndex, -1)
        XCTAssertNil(model.highlight(for: "m0"))
    }

    // MARK: - Rendered-text matching

    private func markdownMessage(_ content: String) -> [FindableMessage] {
        [FindableMessage(id: "m0", content: content, rendersMarkdown: true)]
    }

    func testMarkdownMatchesIgnoreLinkURLs() {
        var model = ConversationFindModel()
        model.update(messages: markdownMessage("see [docs](https://example.com/query-hit) now"),
                     query: "query-hit")
        XCTAssertEqual(model.matchCount, 0)
    }

    func testMarkdownMatchOffsetsAreInRenderedText() {
        var model = ConversationFindModel()
        model.update(messages: markdownMessage("`foo` bar"), query: "foo")
        XCTAssertEqual(model.matches.map(\.range), [0..<3])
    }

    func testMarkdownOrdinalsCountRenderedOccurrencesOnly() {
        var model = ConversationFindModel()
        model.update(messages: markdownMessage("foo then [foo](https://foo.example) end"),
                     query: "foo")
        XCTAssertEqual(model.matchCount, 2)
        model.previous()
        XCTAssertEqual(model.highlight(for: "m0")?.activeOrdinal, 0)
    }

    func testSearchableTextFallsBackToRawContentWhenNotMarkdown() {
        var model = ConversationFindModel()
        model.update(messages: messages(["foo then [foo](https://foo.example) end"]), query: "foo")
        XCTAssertEqual(model.matchCount, 3)
    }
}
