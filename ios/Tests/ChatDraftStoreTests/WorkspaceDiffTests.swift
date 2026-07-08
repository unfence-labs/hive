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
