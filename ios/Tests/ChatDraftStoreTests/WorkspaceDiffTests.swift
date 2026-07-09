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
        let comment = DiffComment(file: "f", line: "b", snippet: nil, text: "note")
        let segments = segmentDiffLines(lines, comments: [comment])
        #expect(segments.count == 2)
        #expect(segments[0].lines.map(\.text) == ["a", "b"])
        #expect(segments[0].comments == [comment])
        #expect(segments[1].lines.map(\.text) == ["c"])
    }

    @Test
    func duplicateLineTextAttachesCommentOnlyOnce() {
        let lines = [line(0, "same"), line(1, "same"), line(2, "end")]
        let comment = DiffComment(file: "f", line: "same", snippet: nil, text: "note")
        let segments = segmentDiffLines(lines, comments: [comment])
        let attached = segments.flatMap(\.comments)
        #expect(attached.count == 1)
        #expect(segments[0].lines.count == 1)
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
