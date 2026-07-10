import XCTest
@testable import HiveMobileStoresCore

final class AnsiLogParserTests: XCTestCase {
    func testPlainLinesSplitOnNewline() {
        var parser = AnsiLogParser()
        parser.feed("first\nsecond\n")
        XCTAssertEqual(parser.lines.map(\.plainText), ["first", "second"])
        XCTAssertNil(parser.pending)
    }

    func testTrailingLineIsPending() {
        var parser = AnsiLogParser()
        parser.feed("done\nworking")
        XCTAssertEqual(parser.lines.map(\.plainText), ["done"])
        XCTAssertEqual(parser.pending?.plainText, "working")
    }

    func testColoredForegroundAndBold() {
        var parser = AnsiLogParser()
        parser.feed("\u{1B}[31mred\u{1B}[0m \u{1B}[1;34mbluebold\u{1B}[0m\n")
        let spans = parser.lines[0].spans
        XCTAssertEqual(spans[0], AnsiSpan(text: "red", color: .indexed(1), bold: false))
        XCTAssertEqual(spans[1], AnsiSpan(text: " ", color: .standard, bold: false))
        XCTAssertEqual(spans[2], AnsiSpan(text: "bluebold", color: .indexed(4), bold: true))
    }

    func testBrightForegroundMapsToHighIndex() {
        var parser = AnsiLogParser()
        parser.feed("\u{1B}[92mbright\n")
        XCTAssertEqual(parser.lines[0].spans[0], AnsiSpan(text: "bright", color: .indexed(10), bold: false))
    }

    func testEscapeSplitAcrossChunks() {
        var parser = AnsiLogParser()
        parser.feed("\u{1B}[3")
        parser.feed("1mHi\n")
        XCTAssertEqual(parser.lines[0].spans[0], AnsiSpan(text: "Hi", color: .indexed(1), bold: false))
    }

    func testUTF8SplitAcrossChunks() {
        var parser = AnsiLogParser()
        let bytes = Array("é".utf8)
        parser.feed(Data([bytes[0]]))
        parser.feed(Data([bytes[1]]))
        parser.feed("\n")
        XCTAssertEqual(parser.lines[0].plainText, "é")
    }

    func testCarriageReturnOverwritesCurrentLine() {
        var parser = AnsiLogParser()
        parser.feed("50%\r100%\n")
        XCTAssertEqual(parser.lines.map(\.plainText), ["100%"])
    }

    func testCarriageReturnKeepsUnwrittenTail() {
        var parser = AnsiLogParser()
        parser.feed("aaaaa\rbb\n")
        XCTAssertEqual(parser.lines[0].plainText, "bbaaa")
    }

    func testEraseLineCollapsesProgressBar() {
        var parser = AnsiLogParser()
        parser.feed("loading....\rok\u{1B}[K\n")
        XCTAssertEqual(parser.lines[0].plainText, "ok")
    }

    func testOtherEscapesStripped() {
        var parser = AnsiLogParser()
        parser.feed("\u{1B}[2J\u{1B}[Hclean\u{1B}]0;title\u{07}er\n")
        XCTAssertEqual(parser.lines[0].plainText, "cleaner")
    }

    func testDesignationEscapeStripped() {
        var parser = AnsiLogParser()
        parser.feed("\u{1B}(Bplain\n")
        XCTAssertEqual(parser.lines[0].plainText, "plain")
    }

    func testDesignationEscapeSplitAcrossChunks() {
        var parser = AnsiLogParser()
        parser.feed("\u{1B}(")
        parser.feed("Bok\n")
        XCTAssertEqual(parser.lines[0].plainText, "ok")
    }

    func testDeviceControlStringStripped() {
        var parser = AnsiLogParser()
        parser.feed("a\u{1B}Psome payload\u{1B}\\b\n")
        XCTAssertEqual(parser.lines[0].plainText, "ab")
    }

    func testEraseWholeLineAndCursorColumnCollapseSpinner() {
        var parser = AnsiLogParser()
        parser.feed("loading\u{1B}[2K\u{1B}[1Gdone\n")
        XCTAssertEqual(parser.lines.map(\.plainText), ["done"])
    }

    func testCursorColumnAbsoluteResetsWriteOffset() {
        var parser = AnsiLogParser()
        parser.feed("abcdef\u{1B}[3GXY\n")
        XCTAssertEqual(parser.lines[0].plainText, "abXYef")
    }

    func testEraseToCursorBlanksLeadingCells() {
        var parser = AnsiLogParser()
        parser.feed("abcdef\u{1B}[4G\u{1B}[1K\n")
        XCTAssertEqual(parser.lines[0].plainText, "    ef")
    }

    func testUnsupported256ColorRendersDefault() {
        var parser = AnsiLogParser()
        parser.feed("\u{1B}[38;5;200mx\n")
        XCTAssertEqual(parser.lines[0].spans[0], AnsiSpan(text: "x", color: .standard, bold: false))
    }

    func testLineCapTruncatesOldest() {
        var parser = AnsiLogParser()
        for i in 0..<2100 {
            parser.feed("line\(i)\n")
        }
        XCTAssertEqual(parser.lines.count, AnsiLogParser.maxLines)
        XCTAssertTrue(parser.truncated)
        XCTAssertEqual(parser.lines.first?.plainText, "line100")
        XCTAssertEqual(parser.lines.last?.plainText, "line2099")
    }

    func testResetClearsEverything() {
        var parser = AnsiLogParser()
        parser.feed("something\n")
        parser.reset()
        XCTAssertTrue(parser.lines.isEmpty)
        XCTAssertNil(parser.pending)
        XCTAssertFalse(parser.truncated)
    }
}
