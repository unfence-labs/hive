import Foundation
import Testing
@testable import HiveMobileStoresCore

struct WorkspaceDiffTests {
    @Test
    func splitsMultiFileDiffAndStripsMetaLines() {
        let raw = """
        diff --git a/src/a.ts b/src/a.ts
        index 111..222 100644
        --- a/src/a.ts
        +++ b/src/a.ts
        @@ -1,2 +1,2 @@
         context
        -old
        +new
        diff --git a/src/b.ts b/src/b.ts
        index 333..444 100644
        --- a/src/b.ts
        +++ b/src/b.ts
        @@ -1 +1,2 @@
         keep
        +added
        """
        let files = splitUnifiedDiff(raw)
        #expect(files.map(\.path) == ["src/a.ts", "src/b.ts"])
        #expect(files[0].text == "@@ -1,2 +1,2 @@\n context\n-old\n+new")
        #expect(!files[0].text.contains("index"))
        #expect(files[1].text.contains("+added"))
    }

    @Test
    func newFileIsAllAdditions() {
        let raw = """
        diff --git a/new.txt b/new.txt
        new file mode 100644
        index 000..111
        --- /dev/null
        +++ b/new.txt
        @@ -0,0 +1,2 @@
        +hello
        +world
        """
        let files = splitUnifiedDiff(raw)
        #expect(files.count == 1)
        #expect(files[0].path == "new.txt")
        let contentLines = files[0].text.split(separator: "\n").filter { !$0.hasPrefix("@@") }
        #expect(!contentLines.isEmpty)
        #expect(contentLines.allSatisfy { $0.hasPrefix("+") })
    }

    @Test
    func deletedFileUsesOldPath() {
        let raw = """
        diff --git a/gone.txt b/gone.txt
        deleted file mode 100644
        --- a/gone.txt
        +++ /dev/null
        @@ -1 +0,0 @@
        -bye
        """
        let files = splitUnifiedDiff(raw)
        #expect(files[0].path == "gone.txt")
    }

    @Test
    func renameCarriesOldName() {
        let raw = """
        diff --git a/old/name.swift b/new/name.swift
        similarity index 100%
        rename from old/name.swift
        rename to new/name.swift
        """
        let files = splitUnifiedDiff(raw)
        #expect(files[0].path == "new/name.swift")
        #expect(files[0].renamedFrom == "old/name.swift")
        #expect(files[0].text.isEmpty)
    }

    @Test
    func binaryFileIsFlagged() {
        let raw = """
        diff --git a/logo.png b/logo.png
        index 111..222 100644
        Binary files a/logo.png and b/logo.png differ
        """
        let files = splitUnifiedDiff(raw)
        #expect(files[0].isBinary)
        #expect(files[0].path == "logo.png")
    }

    @Test
    func emptyInputYieldsNoFiles() {
        #expect(splitUnifiedDiff("").isEmpty)
        #expect(splitUnifiedDiff("not a diff at all").isEmpty)
    }

    @Test
    func unicodePathIsParsed() {
        let raw = """
        diff --git a/src/café.txt b/src/café.txt
        index 111..222 100644
        --- a/src/café.txt
        +++ b/src/café.txt
        @@ -1 +1 @@
        -old
        +new
        """
        let files = splitUnifiedDiff(raw)
        #expect(files[0].path == "src/café.txt")
    }
}

struct DiffSegmentationTests {
    private func line(_ id: Int, _ text: String) -> DiffLine {
        DiffLine(id: id, kind: .added, text: text)
    }

    @Test
    func noCommentsYieldsSingleSegment() {
        let lines = [line(0, "a"), line(1, "b")]
        let segments = segmentDiffLines(lines, comments: [])
        #expect(segments.count == 1)
        #expect(segments[0].lines.map(\.text) == ["a", "b"])
        #expect(segments[0].comments.isEmpty)
    }

    @Test
    func commentSplitsAfterItsLine() {
        let lines = [line(0, "a"), line(1, "b"), line(2, "c")]
        let comment = DiffComment(file: "f", lineID: 1, line: "b", snippet: nil, text: "note")
        let segments = segmentDiffLines(lines, comments: [comment])
        #expect(segments.count == 2)
        #expect(segments[0].lines.map(\.text) == ["a", "b"])
        #expect(segments[0].comments == [comment])
        #expect(segments[1].lines.map(\.text) == ["c"])
    }

    @Test
    func duplicateLineTextAnchorsToTheTappedLine() {
        let lines = [line(0, "same"), line(1, "same"), line(2, "end")]
        let comment = DiffComment(file: "f", lineID: 1, line: "same", snippet: nil, text: "note")
        let segments = segmentDiffLines(lines, comments: [comment])
        let attached = segments.flatMap(\.comments)
        #expect(attached.count == 1)
        #expect(segments.count == 2)
        #expect(segments[0].lines.count == 2)
    }

    @Test
    func blankLineCommentAnchorsExactly() {
        let lines = [line(0, ""), line(1, ""), line(2, "x")]
        let comment = DiffComment(file: "f", lineID: 1, line: "", snippet: nil, text: "note")
        let segments = segmentDiffLines(lines, comments: [comment])
        #expect(segments[0].lines.count == 2)
    }

    @Test
    func emptyDiffYieldsNoSegments() {
        #expect(segmentDiffLines([], comments: []).isEmpty)
    }
}

struct HunkMarkerTests {
    @Test
    func hunkMarkersInsertedBetweenHunksOnly() {
        let diff = "@@ -1 +1 @@\n ctx\n+one\n@@ -9 +9 @@\n ctx2\n-two"
        let plain = parseUnifiedDiffLines(diff)
        #expect(!plain.contains { $0.kind == .hunk })
        let marked = parseUnifiedDiffLines(diff, includeHunkMarkers: true)
        let kinds = marked.map(\.kind)
        #expect(kinds == [.context, .added, .hunk, .context, .removed])
    }
}

struct CompileReviewTests {
    @Test
    func numberedCommentMatchesWebFraming() {
        let comment = DiffComment(file: "src/a.ts", lineID: 0, line: "let x = 1", lineNumber: 12, side: "new code", snippet: nil, text: "handle nil")
        let output = compileReview([comment])
        #expect(output.contains("In `src/a.ts` (line 12, new code):"))
        #expect(output.contains("> let x = 1"))
        #expect(output.contains("handle nil"))
    }

    @Test
    func removedLineIsOldCode() {
        let line = DiffLine(id: 0, kind: .removed, text: "gone", oldLine: 5, newLine: nil)
        let comment = DiffComment(file: "f", line: line, snippet: nil)
        let output = compileReview([comment])
        #expect(output.contains("(line 5, old code)"))
    }

    @Test
    func commentWithoutNumberOmitsLocation() {
        let comment = DiffComment(file: "f", lineID: 0, line: "x", lineNumber: nil, snippet: nil, text: "note")
        let output = compileReview([comment])
        #expect(output.contains("In `f`:"))
        #expect(!output.contains("("))
    }

    @Test
    func multilineSnippetIsBlockquoted() {
        let comment = DiffComment(file: "f", lineID: 0, line: "x", snippet: "a\nb", text: "note")
        let output = compileReview([comment])
        #expect(output.contains("> a\n> b"))
    }
}

struct RangeCommentTests {
    @Test
    func rangeCommentAnchorsAfterItsLastLine() {
        let lines = (0...3).map { DiffLine(id: $0, kind: .added, text: "l\($0)") }
        let comment = DiffComment(file: "f", lineID: 0, line: "l0", endLineID: 2, snippet: nil, text: "note")
        let segments = segmentDiffLines(lines, comments: [comment])
        #expect(segments.count == 2)
        #expect(segments[0].lines.count == 3)
    }

    @Test
    func rangeCommentCompilesAsLinesSpan() {
        let comment = DiffComment(file: "f", lineID: 0, line: "x", lineNumber: 3, endLineNumber: 5, snippet: nil, text: "note")
        let output = compileReview([comment])
        #expect(output.contains("(lines 3-5, new code)"))
    }

    @Test
    func sameStartAndEndCollapsesToSingleLine() {
        let line = DiffLine(id: 1, kind: .added, text: "x", newLine: 7)
        let comment = DiffComment(file: "f", line: line, endLine: line, snippet: nil)
        #expect(comment.endLineID == nil)
        let output = compileReview([comment])
        #expect(output.contains("(line 7, new code)"))
    }
}

struct LineNumberTests {
    @Test
    func numbersFollowHunkHeader() {
        let lines = parseUnifiedDiffLines("@@ -3,2 +7,3 @@\n ctx\n-old\n+new\n+new2")
        #expect(lines[0].oldLine == 3)
        #expect(lines[0].newLine == 7)
        #expect(lines[1].oldLine == 4)
        #expect(lines[1].newLine == nil)
        #expect(lines[2].oldLine == nil)
        #expect(lines[2].newLine == 8)
        #expect(lines[3].newLine == 9)
    }

    @Test
    func secondHunkRestartsNumbers() {
        let lines = parseUnifiedDiffLines("@@ -1 +1 @@\n-a\n@@ -10,2 +20,2 @@\n ctx")
        #expect(lines[0].oldLine == 1)
        #expect(lines[1].oldLine == 10)
        #expect(lines[1].newLine == 20)
    }

    @Test
    func headerlessLinesHaveNoNumbers() {
        let lines = parseUnifiedDiffLines("+one\n-two\n ctx")
        #expect(lines.allSatisfy { $0.oldLine == nil && $0.newLine == nil })
    }

    @Test
    func singleNumberHeaderParses() {
        let lines = parseUnifiedDiffLines("@@ -1 +1,2 @@\n ctx")
        #expect(lines[0].oldLine == 1)
        #expect(lines[0].newLine == 1)
    }

    @Test
    func noNewlineMarkerIsSkippedAndDoesNotShiftNumbers() {
        let lines = parseUnifiedDiffLines("@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file")
        #expect(lines.map(\.kind) == [.removed, .added])
        #expect(lines[0].oldLine == 1)
        #expect(lines[1].newLine == 1)
    }

    @Test
    func headerlessBackslashLineStaysContext() {
        let lines = parseUnifiedDiffLines("+one\n\\ literal backslash line")
        #expect(lines.map(\.kind) == [.added, .context])
    }
}

struct ContentLineEdgeTests {
    @Test
    func plusPlusAndMinusMinusContentLinesAreKept() {
        let lines = parseUnifiedDiffLines("@@ -1,2 +1,2 @@\n---count;\n+++count;\n ctx")
        #expect(lines.map(\.kind) == [.removed, .added, .context])
        #expect(lines.map(\.text) == ["--count;", "++count;", "ctx"])
    }

    @Test
    func fullDiffHeadersAreStillSkipped() {
        let diff = "diff --git a/f.c b/f.c\nindex 111..222 100644\n--- a/f.c\n+++ b/f.c\n@@ -1,2 +1,2 @@\n---count;\n+++count;"
        let lines = parseUnifiedDiffLines(diff)
        #expect(!lines.contains { $0.text == "-- a/f.c" })
        #expect(!lines.contains { $0.text == "++ b/f.c" })
        #expect(lines.contains { $0.kind == .removed && $0.text == "--count;" })
        #expect(lines.contains { $0.kind == .added && $0.text == "++count;" })
    }

    @Test
    func diffStatsCountPlusPlusAndMinusMinusLines() {
        let hunksOnly = parseDiffStats("@@ -1,2 +1,2 @@\n---count;\n+++count;\n ctx")
        #expect(hunksOnly.added == 1)
        #expect(hunksOnly.removed == 1)
        let full = parseDiffStats("diff --git a/f.c b/f.c\nindex 111..222 100644\n--- a/f.c\n+++ b/f.c\n@@ -1,2 +1,2 @@\n---count;\n+++count;")
        #expect(full.added == 1)
        #expect(full.removed == 1)
    }

    @Test
    func headerlessDiffStatsUnchanged() {
        let stats = parseDiffStats("+one\n-two\n ctx")
        #expect(stats.added == 1)
        #expect(stats.removed == 1)
    }
}

struct DiffReviewStoreTests {
    @Test
    func clearRemovesAllReviews() {
        let store = DiffReviewStore()
        store.save(
            workspaceId: "ws-1",
            scope: "uncommitted",
            comments: [DiffComment(file: "a.swift", lineID: 0, line: "line", text: "comment")]
        )

        store.clear()

        #expect(store.restore(workspaceId: "ws-1", scope: "uncommitted").isEmpty)
    }

    @Test
    func savedCommentsRestoreByWorkspaceAndScope() {
        let store = DiffReviewStore()
        let comment = DiffComment(file: "f", lineID: 0, line: "x", snippet: nil, text: "note")
        store.save(workspaceId: "ws1", scope: "committed", comments: [comment])
        #expect(store.restore(workspaceId: "ws1", scope: "committed") == [comment])
        #expect(store.restore(workspaceId: "ws1", scope: "uncommitted").isEmpty)
        #expect(store.restore(workspaceId: "ws2", scope: "committed").isEmpty)
    }

    @Test
    func savingEmptyClears() {
        let store = DiffReviewStore()
        let comment = DiffComment(file: "f", lineID: 0, line: "x", snippet: nil, text: "note")
        store.save(workspaceId: "ws1", scope: "committed", comments: [comment])
        store.save(workspaceId: "ws1", scope: "committed", comments: [])
        #expect(store.restore(workspaceId: "ws1", scope: "committed").isEmpty)
    }

    @Test
    func anchorValidationDropsMovedAndMissingLines() {
        let lines = [DiffLine(id: 0, kind: .added, text: "kept")]
        let valid = DiffComment(file: "f", lineID: 0, line: "kept", snippet: nil, text: "a")
        let movedText = DiffComment(file: "f", lineID: 0, line: "gone", snippet: nil, text: "b")
        let missingFile = DiffComment(file: "other", lineID: 0, line: "kept", snippet: nil, text: "c")
        let result = anchoredComments([valid, movedText, missingFile], linesByFile: ["f": lines])
        #expect(result == [valid])
    }

    @Test
    func anchorValidationChecksEndLine() {
        let lines = [DiffLine(id: 0, kind: .added, text: "a"), DiffLine(id: 1, kind: .added, text: "b")]
        let inRange = DiffComment(file: "f", lineID: 0, line: "a", endLineID: 1, snippet: nil, text: "x")
        let outOfRange = DiffComment(file: "f", lineID: 0, line: "a", endLineID: 9, snippet: nil, text: "y")
        let result = anchoredComments([inRange, outOfRange], linesByFile: ["f": lines])
        #expect(result == [inRange])
    }
}
